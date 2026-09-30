import { afterEach, expect, it, vi } from 'vitest';
import { MAX_EDGE, processImage, TARGET_IMAGE_BYTES } from '../src/image';
afterEach(()=>vi.unstubAllGlobals());
function canvasFixture(fail=false){
 const close=vi.fn(),drawImage=vi.fn(),encoded:{width:number;height:number;mime:string;quality:number}[]=[];
 const canvas={width:0,height:0,getContext:()=>({drawImage}),toBlob:(callback:(b:Blob|null)=>void,mime:string,quality:number)=>{
  encoded.push({width:canvas.width,height:canvas.height,mime,quality});
  const bytes=new Uint8Array(quality>.7?340000:260000);if(mime==='image/webp'){bytes.set(new TextEncoder().encode('RIFF'));bytes.set(new TextEncoder().encode('WEBP'),8);}else bytes.set([255,216,255]);
  callback(fail?null:new Blob([bytes],{type:mime}));
 }};
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:4032,height:3024,close})));
 vi.stubGlobal('document',{createElement:()=>canvas});return {canvas,close,drawImage,encoded};
}
it('encodiert ein Original neu, hält 1280 px/300 KB ein und senkt Qualität nur wenn nötig',async()=>{
 const fixture=canvasFixture(),original=new File(['Original mit privaten Metadaten'],'original.jpg',{type:'image/jpeg'});
 const result=await processImage(original);expect(result).not.toBe(original);expect(result.size).toBeLessThanOrEqual(TARGET_IMAGE_BYTES);expect(result.type).toBe('image/webp');
 expect(fixture.encoded.map(e=>e.quality)).toEqual([.78,.78,.62]);expect(fixture.encoded.every(e=>e.width===MAX_EDGE&&e.height===960)).toBe(true);
 expect(fixture.close).toHaveBeenCalledOnce();expect(fixture.canvas.width+fixture.canvas.height).toBe(0);
});
it('räumt Decoder und Canvas auch auf, wenn das Encodieren fehlschlägt',async()=>{
 const fixture=canvasFixture(true);await expect(processImage(new File(['x'],'x.jpg',{type:'image/jpeg'}))).rejects.toThrow('verkleinert');
 expect(fixture.close).toHaveBeenCalledOnce();expect(fixture.canvas.width+fixture.canvas.height).toBe(0);
});
