import { useEffect, useState } from "react"
import * as uuid from 'uuid';

export interface IUseConferenceProps {
    localMediaStream?: MediaStream;
    localDisplayStream?: MediaStream;
    firstName: string;
    lastName: string;
    position: string;
    roomId: string;
    peerId?: string;
}

export enum WebSocketMessageType {
    OFFER = "offer",
    ANSWER = "answer",
    CANDIDATE = "candidate",
    JOIN_ROOM = "joinRoom",
    LEAVE_ROOM = "leaveRoom",
    ROOM = "room"
}

export interface IWebSocketMessage {
    event: WebSocketMessageType;
    data: any;
}

export interface IPeer {
    id: string;
    firstName: string;
    lastName: string;
    position: string;
    tracksIds: string[];
    streamsIds: string[];
    streams: MediaStream[];
}

export interface IPresentation {

    peerId: string;
    stream: MediaStream;
}

const generatePeerId = () => {
    return uuid.v4();
}

const findsStreamsByStreamsIds = (streams: MediaStream[], streamsIds: string[]) => {
    const streamsFound: MediaStream[] = [];

    for (const stream of streams) {
        const streamInTrack = !!streamsIds.find(st => st == stream.id);

        if (streamInTrack) {
            streamsFound.push(stream);
            break;
        }
    }

    return streamsFound;
}

export const useConference = ({
    localMediaStream,
    localDisplayStream,
    firstName,
    lastName,
    position,
    roomId: roomIdInitial,
    peerId: peerIdInitial
}: IUseConferenceProps) => {
    const [socket, setSocket] = useState<WebSocket | undefined>(undefined);
    const [connection, setConnection] = useState<RTCPeerConnection | undefined>(undefined);
    const [roomId, setRoomId] = useState<string>(roomIdInitial);
    const [peerId, setPeerId] = useState<string>(peerIdInitial || generatePeerId());
    const [messages, setMessages] = useState<IWebSocketMessage[]>([]);
    const [presentation, setPresentation] = useState<IPresentation | undefined>();

    const [streams, setStreams] = useState<MediaStream[]>([]);
    const [peers, setPeers] = useState<IPeer[]>([]);

    const [isJoined, setIsJoined] = useState<boolean>(false);
    const [isJoining, setIsJoining] = useState<boolean>(true);
    const [isHandling, setIsHandling] = useState<boolean>(false);
    const [isLocalDescriptionSet, setIsLocalDescriptionSet] = useState<boolean>(false);
    const [isRemoteDescriptionSet, setIsRemoteDescriptionSet] = useState<boolean>(false);

    // Use effect to set websocket connection
    useEffect(() => {
        if (!roomId || !peerId) {
            return;
        }

        connectWebsocket();
    }, [roomId, peerId]);

    useEffect(() => {
        if (!roomId || !peerId) {
            return;
        }

        if (!socket) {
            return;
        }

        if (isJoined) {
            return;
        }

        if (isJoining) {
            return;
        }

        joinRoom();
    }, [socket]);

    useEffect(() => {
        if (!roomId || !peerId) {
            return;
        }

        if (!isJoined) {
            return;
        }

        connectWebRTC();
    }, [isJoined]);

    useEffect(() => {
        if (!roomId || !peerId) {
            return;
        }

        if (!connection) {
            return;
        }

        if (isLocalDescriptionSet) {
            return;
        }

        addLocalMediaStream();

        // if (localDisplayStream) {
        //     addLocalDisplayStream();
        // }
        sendOffer();
    }, [connection]);

    useEffect(() => {
        if (!roomId || !peerId) {
            return;
        }

        if (!connection) {
            return;
        }

        if (!localDisplayStream) {
            return
        }

        addLocalDisplayStream();
        sendOffer();
    }, [localDisplayStream]);

    useEffect(() => {
        if (!roomId || !peerId) {
            return;
        }

        if (!messages.length) {
            return;
        }

        if (isHandling) {
            return;
        }

        setIsHandling(true);

        const message = messages[0];

        setMessages((v) => {
            const updatedMessages = [...v];
            updatedMessages.shift();

            return updatedMessages;
        });

        handleOnMessage(message!).finally(() => {
            setIsHandling(false);
        });
    }, [messages, isHandling]);

    useEffect(() => {
        console.log('ON STREAMs')
        const updatedPeers: IPeer[] = [];

        for (const peerIndex in peers) {
            const peer = peers[peerIndex];

            const peerStreams = findsStreamsByStreamsIds(streams, peer.streamsIds);
            const updatedPeer = { ...peer, streams: peerStreams };
            updatedPeers.push(updatedPeer);

            if (updatedPeer.streams[1]) {
                setPresentation({
                    peerId: peerId,
                    stream: updatedPeer.streams[1]
                });
            }
        }

        setPeers(updatedPeers);
    }, [streams]);

    const connectWebRTC = () => {
        // if (!roomId || !peerId || !socket) {
        //     console.log('Error, invalid behavior')
        //     return;
        // }

        const webrtc = new RTCPeerConnection({});
        setConnection(webrtc);

        webrtc.ontrack = (event) => {
            const stream = event.streams[0];
            if (!stream) {
                return;
            }

            setStreams(prev => [...prev, stream]);
        };

        webrtc.onicecandidate = (event) => {
            if (!event.candidate) {
                return;
            }

            const message: IWebSocketMessage = {
                data: {
                    roomId: roomId,
                    peerId: peerId,
                    candidate: event.candidate
                },
                event: WebSocketMessageType.CANDIDATE
            };

            socket!.send(JSON.stringify(message));
        };

        webrtc.onconnectionstatechange = (e) => {
            console.log('onconnectionstatechange', e);
        };

        webrtc.onicegatheringstatechange = (e) => {
            console.log('onicegatheringstatechange', e);
        };
    };

    const addLocalMediaStream = async () => {
        if (!localMediaStream || !connection) {
            console.log('Error, invalid behavior');
            return;
        }

        localMediaStream.getTracks().forEach(track => {
            connection.addTrack(track, localMediaStream);
        });
    }

    const addLocalDisplayStream = async () => {
        if (!localDisplayStream || !connection) {
            console.log('Error, invalid behavior');
            return;
        }
        
        console.log('ADD LOCAL DISPLAY STREAM')

        setPresentation({
            peerId: peerId,
            stream: localDisplayStream
        })

        localDisplayStream.getTracks().forEach(track => {
            connection.addTrack(track, localDisplayStream);
        });
    }

    const sendOffer = async () => {
        if (!roomId || !peerId || !socket || !connection || !isJoined) {
            console.log('Error, invalid behavior');
            return;
        }

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        setIsLocalDescriptionSet(true);

        const message: IWebSocketMessage = {
            event: WebSocketMessageType.OFFER,
            data: {
                roomId: roomId,
                peerId: peerId,
                offer: offer
            }
        };

        socket.send(JSON.stringify(message));
    };

    const handleOnAnswer = async (data: string) => {
        if (!roomId || !peerId || !socket || !connection) {
            console.log('Error, invalid behavior')
            return;
        }

        const value = JSON.parse(data);

        await connection.setRemoteDescription(value);
        setIsRemoteDescriptionSet(true);
    };

    const handleOnCandidate = async (data: string) => {
        // if (!roomId || !peerId || !socket || !connection) {
        //     console.log('Error, invalid behavior')
        //     return;
        // }

        const value = JSON.parse(data);
        await connection!.addIceCandidate(new RTCIceCandidate(value));
    };

    const handleOnOffer = async (data: string) => {
        // if (!roomId || !peerId || !socket || !connection) {
        //     console.log('Error, invalid behavior')
        //     return;
        // }

        const value = JSON.parse(data);

        await connection!.setRemoteDescription(value);
        setIsRemoteDescriptionSet(true);

        const answer = await connection!.createAnswer();
        await connection!.setLocalDescription(answer);
        setIsLocalDescriptionSet(true);

        const message: IWebSocketMessage = {
            event: WebSocketMessageType.ANSWER,
            data: {
                roomId: roomId,
                peerId: peerId,
                answer: answer
            }
        };

        socket!.send(JSON.stringify(message));
    }

    const handleOnJoinRoom = async (joinPeerId: string) => {
        if (!roomId || !peerId || !socket) {
            console.log('Error, invalid behavior')
            return;
        }

        if (joinPeerId == peerId) {
            setIsJoined(true);
            setIsJoining(true);
        }
    };

    const handleOnRoom = async (data: any) => {
        const updatedPeers: IPeer[] = Object.values(data).map((raw: any) => {
            const tracksIds = Object.keys(raw.tracksIn);
            const streamsIds = Object.keys(raw.streamsIn);

            return {
                id: raw.id,
                firstName: raw.firstName,
                lastName: raw.lastName,
                position: raw.position,
                tracksIds: tracksIds,
                streamsIds: streamsIds,
                streams: findsStreamsByStreamsIds(streams, streamsIds)
            };
        });

        setPeers(updatedPeers);
    };

    const handleOnMessage = async (message: IWebSocketMessage) => {
        switch (message.event) {
            case WebSocketMessageType.ANSWER: {
                await handleOnAnswer(message.data);
                break;
            }
            case WebSocketMessageType.CANDIDATE: {
                await handleOnCandidate(message.data);
                break;
            }
            case WebSocketMessageType.OFFER: {
                await handleOnOffer(message.data);
                break;
            }
            case WebSocketMessageType.JOIN_ROOM: {
                await handleOnJoinRoom(message.data);
                break;
            }
            case WebSocketMessageType.ROOM: {
                await handleOnRoom(message.data);
                break;
            }
        }
    }

    const connectWebsocket = () => {
        const websocket = new WebSocket(process.env.NEXT_PUBLIC_CONFERENCE);

        websocket.onopen = () => {
            console.log('websocket connection open');
            setSocket(websocket);
        };

        websocket.onclose = () => {
            console.log('websocket connection close');
            setSocket(undefined);
        };

        websocket.onmessage = (e) => {
            const message: IWebSocketMessage = JSON.parse(e.data);

            setMessages((v) => {
                const updatedMessages = [...v];
                updatedMessages.push(message);

                return updatedMessages;
            });
        };

        websocket.onerror = (e) => {
            console.log('websocket connection error', e);
        }
    }

    const joinRoom = () => {
        if (!roomId || !peerId || !socket) {
            console.log(roomId, peerId, socket);
            console.log('Error, invalid behavior')
            return;
        }

        const message: IWebSocketMessage = {
            data: {
                roomId: roomId,
                peerId: peerId,
                firstName: firstName || "",
                lastName: lastName || "",
                position: position || ""
            },
            event: WebSocketMessageType.JOIN_ROOM
        };

        socket.send(JSON.stringify(message));
        setIsJoining(true);
    }

    const leaveRoom = () => {
        if (!roomId || !peerId || !socket) {
            console.log('Error, invalid behavior')
            return;
        }

        const message: IWebSocketMessage = {
            data: {
                roomId: roomId,
                peerId: peerId
            },
            event: WebSocketMessageType.LEAVE_ROOM
        };

        socket.send(JSON.stringify(message));
        setIsJoined(false);
        setIsJoining(false);
    }

    return {
        peerId,
        roomId,
        connection,
        socket,
        joinRoom,
        leaveRoom,
        peers,
        isJoined,
        presentation
    };
}
