package com.oney.WebRTCModule;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** Single authorized file. Bounds native-to-JS copies before encoding/allocation. */
final class AxonicStreamDataGuard {
    private static final int WINDOW = 256 * 1024;
    private boolean rejected, authorized;
    private long total, received, consumed;
    private int controls;

    synchronized boolean authorize(long bytes) {
        if (rejected || authorized || bytes < 1 || bytes > 250L * 1024 * 1024) return false;
        authorized = true; total = bytes; return true;
    }
    synchronized boolean consume(long offset) {
        if (rejected || !authorized || offset < consumed || offset > received) return false;
        consumed = offset; return true;
    }
    synchronized boolean receive(ByteBuffer data, boolean binary) {
        if (rejected) return false;
        int size = data == null ? 0 : data.remaining();
        boolean valid = size > 0;
        if (binary) {
            valid &= authorized && size <= 16 * 1024 && received + size <= total
                && received - consumed + size <= WINDOW;
            if (valid) received += size;
        } else {
            // Sender lanes only receive bounded control frames; receiver lanes
            // need one offer before their native authorization is applied.
            valid &= size <= 1024 && ++controls <= 8192;
            if (valid) try {
                StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(data.asReadOnlyBuffer());
            } catch (Exception invalid) { valid = false; }
        }
        if (!valid) rejected = true;
        return valid;
    }
}
