export interface RequestMessage {
    type: 'PUT' | 'GET' | 'DELETE';
    key: string;
    value?: string;
}

export interface ResponseMessage {
    type: 'RESPONSE';
    success: boolean;
    data?: string;
    error?: string;
}

export interface HeartbeatMessage {
    type: 'HEARTBEAT';
    nodeId: string;
}

export interface MembershipMessage {
    type: 'JOIN' | 'LEAVE';
    nodeId: string;
}

export interface ReplicationMessage {
    type: 'REPLICATE';
    key: string;
    value: string;
}

// Generic message type used by transport
export type Message =
    | RequestMessage
    | ResponseMessage
    | HeartbeatMessage
    | MembershipMessage
    | ReplicationMessage;