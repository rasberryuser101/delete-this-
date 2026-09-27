import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
export function JoinQr({link}:{link:string}) {
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{if(canvas.current)void QRCode.toCanvas(canvas.current,link,{width:220,margin:2,errorCorrectionLevel:'M'}).catch(()=>{});},[link]);
 return <canvas ref={canvas} role="img" aria-label="QR-Code zum Öffnen des Einladungslinks" style={{maxWidth:'100%',height:'auto',display:'block',margin:'1rem auto'}}/>;
}
