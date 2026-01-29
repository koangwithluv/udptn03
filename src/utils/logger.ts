import fs from 'fs';
import path from 'path';

class Logger {
    private logFilePath: string;

    constructor() {
        this.logFilePath = path.join(__dirname, 'app.log');
    }

    log(message: string): void {
        const timestamp = new Date().toISOString();
        const logMessage = `${timestamp} - ${message}\n`;
        fs.appendFileSync(this.logFilePath, logMessage);
    }

    info(message: string): void {
        this.log(`INFO: ${message}`);
    }

    warn(message: string): void {
        this.log(`WARN: ${message}`);
    }

    error(message: string): void {
        this.log(`ERROR: ${message}`);
    }
}

const logger = new Logger();
export default logger;