import { fetchTransactionStatus } from 'o1js';

export async function wait(
    txId: string,
    minaRPCNetworkUrl: string,
    maxAttempts = 50,
    intervalMs = 20000,
    maxUnknownCount = 5
): Promise<boolean> {
    let attempt = 0;
    let unknownCount = 0;
    return new Promise((resolve, reject) => {
        (async () => {
            attempt++;
            do {
                const status = await fetchTransactionStatus(
                    txId,
                    minaRPCNetworkUrl
                );
                switch (status) {
                    case 'INCLUDED': {
                        resolve(true);
                        break;
                    }
                    case 'PENDING': {
                        break;
                    }
                    case 'UNKNOWN': {
                        if (unknownCount < maxUnknownCount) {
                            unknownCount++;
                            break;
                        }
                        reject(new Error(`Transaction UNKNOWN status.`));
                        break;
                    }
                }
                await new Promise((resolve) => setTimeout(resolve, intervalMs));
            } while (attempt <= maxAttempts);
            reject(new Error('Max attempts breached.'));
        })().catch((err) => reject(err));
    });
}
