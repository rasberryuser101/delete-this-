export class FakeChannel extends EventTarget {
 label='photo-transfer';readyState:RTCDataChannelState='open';ordered=true;maxRetransmits=null;maxPacketLifeTime=null;binaryType='arraybuffer';bufferedAmount=0;bufferedAmountLowThreshold=0;
 other?:FakeChannel;sent:(string|ArrayBuffer)[]=[];
 send(data:string|ArrayBuffer){if(this.readyState!=='open')throw new Error('closed');this.sent.push(data);const copy=typeof data==='string'?data:data.slice(0);queueMicrotask(()=>{if(this.other?.readyState==='open')this.other.dispatchEvent(new MessageEvent('message',{data:copy}));});}
 close(){if(this.readyState==='closed')return;this.readyState='closed';this.dispatchEvent(new Event('close'));}
 asRTC(){return this as unknown as RTCDataChannel;}
}
export function channelPair(){const a=new FakeChannel(),b=new FakeChannel();a.other=b;b.other=a;return {a,b};}
