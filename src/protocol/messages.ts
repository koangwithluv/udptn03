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
    type: 'JOIN' | 'LEAVE' | 'MEMBERSHIP_SNAPSHOT';
    nodeId: string;
    epoch?: number;
    peers?: number[];
}

export interface ReplicationMessage {
    type: 'REPL_PUT' | 'REPL_DEL';
    key: string;
    value?: string;
    opId?: string;
}

export interface SnapshotRequestMessage {
    type: 'SNAPSHOT_REQUEST';
    from: string;
}

export interface SnapshotChunkMessage {
    type: 'SNAPSHOT_CHUNK';
    data: Record<string, string>;
    seq?: number;
    total?: number;
    checksum?: string;
}

export interface SnapshotDoneMessage {
    type: 'SNAPSHOT_DONE';
    totalChunks: number;
    checksum?: string;
    version?: number;
}

export interface RebalancePushMessage {
    type: 'REBALANCE_PUSH';
    entries: Record<string, string>;
    from: number;
}

// Generic message type used by transport
export type Message =
    | RequestMessage
    | ResponseMessage
    | HeartbeatMessage
    | MembershipMessage
    | ReplicationMessage
    | SnapshotRequestMessage
    | SnapshotChunkMessage
    | SnapshotDoneMessage
    | RebalancePushMessage;