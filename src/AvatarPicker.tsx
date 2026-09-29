import { AVATARS, mediaUrl } from './customization';
export function AvatarPicker({value,onChange}:{value:string;onChange:(path:string)=>void}) {
  return <details className="avatar-picker"><summary>Dein Profilbild {value&&<img className="avatar-art" src={mediaUrl(value)} alt="Ausgewähltes Profilbild"/>}</summary><div className="avatar-grid">{AVATARS.map((path,i)=><button key={path} type="button" className={path===value?'selected':''} aria-label={`Profilbild ${i+1}`} aria-pressed={path===value} onClick={()=>onChange(path)}><img src={mediaUrl(path)} alt=""/></button>)}</div></details>;
}
