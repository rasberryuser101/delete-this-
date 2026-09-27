export type RequestContext = {peerId:string; metadata?:unknown; signal:AbortSignal};
export type RequestOptions = {target:string;metadata?:unknown;signal?:AbortSignal;timeoutMs?:number;onProgress?:(n:number)=>void};
export interface RequestAction<T,R> {
  request(data:T, options:RequestOptions):Promise<R>;
  onRequest:((data:T, context:RequestContext)=>R|Promise<R>)|null;
}
