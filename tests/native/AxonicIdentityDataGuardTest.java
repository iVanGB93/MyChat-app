package com.oney.WebRTCModule;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

public final class AxonicIdentityDataGuardTest {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
    private static ByteBuffer text(String s) { return ByteBuffer.wrap(s.getBytes(StandardCharsets.UTF_8)); }
    public static void main(String[] args) {
        AxonicIdentityDataGuard g = new AxonicIdentityDataGuard();
        check("hello".equals(g.receive(text("hello"), false, 0)), "valid text");
        check("é😀".equals(g.receive(text("é😀"), false, 1)), "valid multibyte text");
        check(g.receive(text("x".repeat(20000)), false, 2).length() == 20000, "exact byte limit");
        check(new AxonicIdentityDataGuard().receive(text("é".repeat(10000)), false, 0).length() == 10000, "UTF-8 byte boundary");
        check(new AxonicIdentityDataGuard().receive(text("é".repeat(10001)), false, 0) == null, "multibyte overflow");
        check(g.receive(text("x".repeat(20001)), false, 3) == null, "oversized");
        check(g.receive(text("hello"), false, 60001) == null, "rejection is permanent");
        check(new AxonicIdentityDataGuard().receive(text("x"), true, 0) == null, "binary rejected");
        check(new AxonicIdentityDataGuard().receive(text(""), false, 0) == null, "empty rejected");
        byte[][] invalid = { {(byte)0xc0,(byte)0xaf}, {(byte)0xed,(byte)0xa0,(byte)0x80}, {(byte)0xe2,(byte)0x82}, {(byte)0xff} };
        for (byte[] bytes : invalid) check(new AxonicIdentityDataGuard().receive(ByteBuffer.wrap(bytes), false, 0) == null, "invalid UTF-8 rejected");
        ByteBuffer backing = ByteBuffer.allocate(100000);
        backing.position(50000); backing.put("slice".getBytes(StandardCharsets.UTF_8));
        backing.limit(50005); backing.position(50000);
        check("slice".equals(new AxonicIdentityDataGuard().receive(backing, false, 0)), "only remaining bytes decoded");
        check(backing.position() == 50000, "source position preserved");
        ByteBuffer direct = ByteBuffer.allocateDirect(5); direct.put("hello".getBytes(StandardCharsets.UTF_8)).flip();
        check("hello".equals(new AxonicIdentityDataGuard().receive(direct, false, 0)), "native direct buffer");
        g = new AxonicIdentityDataGuard();
        for (int i=0; i<64; i++) check(g.receive(text("x"), false, i) != null, "bounded valid burst");
        check(g.receive(text("x"), false, 64) == null, "burst limit enforced");
        g.authenticated();check(g.receive(text("x"), false, 65)==null,"authentication cannot revive a rejected channel");
        g = new AxonicIdentityDataGuard();
        for(int i=0;i<10;i++)check(g.receive(text("x"),false,i)!=null,"handshake frames");
        g.authenticated();
        for(int i=10;i<3856;i++)check(g.receive(text("x"),false,i)!=null,"authenticated control and attachment budget");
        check(g.receive(text("x"),false,3856)==null,"authenticated budget remains bounded");
        g = new AxonicIdentityDataGuard();
        for (int i=0; i<64; i++) check(g.receive(text("x"), false, i) != null, "first window");
        check(g.receive(text("x"), false, 60000) != null, "new window allowed");
        System.out.println("Native identity guard: byte bounds, UTF-8, direct/sliced buffers, permanent rejection and rate limits passed");
    }
}
