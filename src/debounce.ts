import { logger } from './logger';

export function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | undefined;

    return function(this: any, ...args: Parameters<T>) {
        const context = this;
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            Promise.resolve(func.apply(context, args)).catch((error) => {
                logger.error('Debounced function error:', error);
            });
        }, wait);

    };
}