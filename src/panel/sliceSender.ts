import type { HostMessage, SliceName } from '../shared/panelContract';

type SliceValue<Name extends SliceName> = Extract<HostMessage, { slice: Name }>['value'];

/**
 * Sends the panel its slices, each only when it has changed since it was last sent. The host builds every slice
 * whenever something happens and hands them all over; this is what keeps a save from resending the Project, and a
 * dry-run result from resending the SQL.
 */
export class SliceSender {
    private readonly sent = new Map<SliceName, string>();

    /** @param post Posts one message to the panel, e.g. `webview.postMessage` */
    constructor(private readonly post: (message: HostMessage) => unknown) {}

    /** Sends the slice unless what the panel has is the same. Returns whether it was sent */
    send<Name extends SliceName>(slice: Name, value: SliceValue<Name>): boolean {
        const serialised = JSON.stringify(value);
        if (this.sent.get(slice) === serialised) {
            return false;
        }
        this.sent.set(slice, serialised);
        this.post({ slice, value } as HostMessage);
        return true;
    }

    /** Forgets what was sent: the panel was reloaded and has nothing */
    reset() {
        this.sent.clear();
    }
}
