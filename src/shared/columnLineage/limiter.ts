/** Runs at most `max` tasks at once: higher priority first, then in order of arrival */
export class Limiter {
    private running = 0;
    private arrivals = 0;
    private readonly queue: { priority: number; arrival: number; start: () => void }[] = [];

    constructor(private readonly max: number) {}

    run<T>(priority: number, task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const start = () => {
                this.running++;
                Promise.resolve()
                    .then(task)
                    .then(resolve, reject)
                    .finally(() => {
                        this.running--;
                        this.next();
                    });
            };
            this.queue.push({ priority, arrival: this.arrivals++, start });
            this.queue.sort((a, b) => b.priority - a.priority || a.arrival - b.arrival);
            this.next();
        });
    }

    private next() {
        while (this.running < this.max && this.queue.length > 0) {
            this.queue.shift()!.start();
        }
    }
}
