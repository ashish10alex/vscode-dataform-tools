import * as assert from "assert";
import { suite, test, beforeEach, afterEach } from "mocha";
import { snoozeManager } from "../../utils/snoozeManager";

suite("SnoozeManager Test Suite", () => {
    beforeEach(() => {
        snoozeManager.stopSnooze(false);
    });

    afterEach(() => {
        snoozeManager.dispose();
    });

    test("initial state is inactive", () => {
        assert.strictEqual(snoozeManager.isSnoozeActive(), false);
        assert.strictEqual(snoozeManager.getSnoozeEndTime(), null);
        assert.strictEqual(snoozeManager.hasDirtyEditsDuringSnooze(), false);
    });

    test("startSnooze activates snooze with specified duration", () => {
        const start = Date.now();
        snoozeManager.startSnooze(undefined, 5);

        assert.strictEqual(snoozeManager.isSnoozeActive(), true);
        const endTime = snoozeManager.getSnoozeEndTime();
        assert.ok(endTime !== null);
        assert.ok(endTime! >= start + 5 * 60 * 1000 - 100);
        assert.ok(endTime! <= start + 5 * 60 * 1000 + 1000);
    });

    test("re-triggering startSnooze resets the countdown", () => {
        snoozeManager.startSnooze(undefined, 2);
        const firstEnd = snoozeManager.getSnoozeEndTime();

        snoozeManager.startSnooze(undefined, 5);
        const secondEnd = snoozeManager.getSnoozeEndTime();

        assert.ok(secondEnd! > firstEnd!);
    });

    test("markDirtyDuringSnooze flags dirty state when active", () => {
        snoozeManager.startSnooze(undefined, 5);
        assert.strictEqual(snoozeManager.hasDirtyEditsDuringSnooze(), false);

        snoozeManager.markDirtyDuringSnooze();
        assert.strictEqual(snoozeManager.hasDirtyEditsDuringSnooze(), true);
    });

    test("stopSnooze triggers callback if marked dirty", async () => {
        let callbackCalled = false;
        snoozeManager.setOnSnoozeEndedCallback(() => {
            callbackCalled = true;
        });

        snoozeManager.startSnooze(undefined, 5);
        snoozeManager.markDirtyDuringSnooze();

        await snoozeManager.stopSnooze(false);

        assert.strictEqual(snoozeManager.isSnoozeActive(), false);
        assert.strictEqual(snoozeManager.getSnoozeEndTime(), null);
        assert.strictEqual(callbackCalled, true);
    });

    test("stopSnooze does not trigger callback if not dirty", async () => {
        let callbackCalled = false;
        snoozeManager.setOnSnoozeEndedCallback(() => {
            callbackCalled = true;
        });

        snoozeManager.startSnooze(undefined, 5);
        await snoozeManager.stopSnooze(false);

        assert.strictEqual(snoozeManager.isSnoozeActive(), false);
        assert.strictEqual(callbackCalled, false);
    });

    test("registerWebviewHandlers receives status messages on start and stop", async () => {
        const messages: any[] = [];
        snoozeManager.registerWebviewHandlers(
            (msg) => messages.push(msg),
            () => true
        );

        snoozeManager.startSnooze(undefined, 5);
        assert.strictEqual(messages.length, 1);
        assert.ok(messages[0].snoozeEndTime !== null);

        await snoozeManager.stopSnooze(false);
        assert.strictEqual(messages.length, 2);
        assert.strictEqual(messages[1].snoozeEndTime, null);
    });
});
