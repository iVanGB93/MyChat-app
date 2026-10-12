package com.oney.WebRTCModule;
import java.nio.ByteBuffer;
public final class AxonicStreamDataGuardTest {
    static void check(boolean result) { if (!result) throw new AssertionError(); }
    public static void main(String[] args) {
        AxonicStreamDataGuard g = new AxonicStreamDataGuard();
        check(!g.receive(ByteBuffer.allocate(1), true)); check(!g.authorize(1));
        g = new AxonicStreamDataGuard();check(g.authorize(524288));check(!g.authorize(524288));
        for (int n=0;n<16;n++)check(g.receive(ByteBuffer.allocate(16384),true));
        check(!g.consume(262145));check(g.consume(131072));
        for (int n=0;n<8;n++)check(g.receive(ByteBuffer.allocate(16384),true));
        check(!g.receive(ByteBuffer.allocate(1),true)); // credit exhausted, sticky rejection
        check(!g.consume(393216));
        g = new AxonicStreamDataGuard();check(g.authorize(17));
        ByteBuffer backing=ByteBuffer.allocate(50000);backing.position(10);backing.limit(27);
        check(g.receive(backing,true));check(backing.position()==10);check(g.consume(17));
        check(!g.receive(ByteBuffer.allocate(1),true));
        g = new AxonicStreamDataGuard();check(!g.receive(ByteBuffer.allocate(1025),false));
        g = new AxonicStreamDataGuard();check(!g.receive(ByteBuffer.wrap(new byte[]{(byte)0xff}),false));
        g = new AxonicStreamDataGuard();check(g.authorize(100000));check(!g.receive(ByteBuffer.allocate(16385),true));
        System.out.println("Native stream admission checks passed");
    }
}
