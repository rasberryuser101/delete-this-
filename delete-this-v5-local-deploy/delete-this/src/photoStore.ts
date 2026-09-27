/** Ausschließlich flüchtiger Arbeitsspeicher: keine Persistenz, keine Uploads. */
export class PhotoStore {
  private photos = new Map<string,{url:string; blob:Blob}>();
  put(id:string, blob:Blob): void {
    const previous=this.photos.get(id);
    if(previous) URL.revokeObjectURL(previous.url);
    this.photos.set(id,{url:URL.createObjectURL(blob),blob});
  }
  getBlob(id:string): Blob | undefined { return this.photos.get(id)?.blob; }
  urls(): Record<string,string> { return Object.fromEntries([...this.photos].map(([id,photo])=>[id,photo.url])); }
  clear(): void { this.photos.forEach(photo=>URL.revokeObjectURL(photo.url)); this.photos.clear(); }
}
