import { Node } from './node';
import { RequestMessage, ResponseMessage } from '../protocol/messages';
import logger from '../utils/logger';

export class Recovery {
    private node: Node;

    constructor(node: Node) {
        this.node = node;
    }

    public async recoverData() {
        logger.log('Starting recovery process...');
        const missingData = await this.checkForMissingData();
        if (missingData.length > 0) {
            for (const data of missingData) {
                await this.requestDataFromReplica(data);
            }
        } else {
            logger.log('No missing data found.');
        }
    }

    private async checkForMissingData(): Promise<string[]> {
        // Compare local store against global replica view
        const missing: string[] = [];
        const replicas = (this.node as any).constructor['globalReplica'] as Map<string, string> | undefined;
        if (!replicas) return missing;
        for (const key of replicas.keys()) {
            if (!this.node.hasKey(key)) missing.push(key);
        }
        return missing;
    }

    private async requestDataFromReplica(key: string) {
        const replicas = this.node.getReplicas();
        for (const replica of replicas) {
            const response: ResponseMessage = await this.sendRecoveryRequest(replica, key);
            if (response.success && response.data !== undefined) {
                this.node.storeData(key, response.data);
                logger.log(`Recovered data for key: ${key} from replica: ${replica}`);
                return;
            }
        }
        logger.log(`Failed to recover data for key: ${key} from all replicas.`);
    }

    private async sendRecoveryRequest(replica: string, key: string): Promise<ResponseMessage> {
        // For this simplified implementation we look into the global replica state
        const replicas = (this.node as any).constructor['globalReplica'] as Map<string, string> | undefined;
        const data = replicas?.get(key);
        return { type: 'RESPONSE', success: data !== undefined, data };
    }
}