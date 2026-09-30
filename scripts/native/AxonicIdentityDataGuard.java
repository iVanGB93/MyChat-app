package com.oney.WebRTCModule;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** Identity channels only. Runs after libwebrtc reception, before bridge copies. */
final class AxonicIdentityDataGuard {
    private boolean rejected;
    private long windowStart = -1;
    private int frames;

    synchronized String receive(ByteBuffer data, boolean binary, long now) {
        if (rejected) return null;
        if (windowStart < 0 || now - windowStart >= 60_000) {
            windowStart = now;
            frames = 0;
        }
        if (binary || data == null || data.remaining() == 0 || data.remaining() > 20_000 || ++frames > 64) {
            rejected = true;
            return null;
        }
        try {
            // Respect position/limit even for buffers with a much larger backing array.
            return StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(data.asReadOnlyBuffer()).toString();
        } catch (CharacterCodingException invalid) {
            rejected = true;
            return null;
        }
    }
}
