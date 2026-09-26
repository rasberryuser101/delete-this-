import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoStore } from '../src/photoStore';
afterEach(()=>vi.unstubAllGlobals());
describe('Bildreferenzen aufräumen',()=>{
  it('entfernt alte Object URLs bei Ersatz und alle URLs am Rundenende',()=>{
    let n=0; const revoked:string[]=[];
    vi.stubGlobal('URL',{createObjectURL:()=>`blob:test-${++n}`,revokeObjectURL:(url:string)=>revoked.push(url)});
    const store=new PhotoStore(); const blob=new Blob(['photo']);
    store.put('eins',blob); store.put('zwei',blob); store.put('eins',blob);
    expect(revoked).toEqual(['blob:test-1']);
    expect(store.urls()).toEqual({eins:'blob:test-3',zwei:'blob:test-2'});
    store.clear(); expect(revoked).toEqual(['blob:test-1','blob:test-3','blob:test-2']);
    expect(store.urls()).toEqual({}); expect(store.getBlob('eins')).toBeUndefined();
  });
});
