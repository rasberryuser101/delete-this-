import { AVATARS, mediaUrl } from './customization';
import { useRef } from 'react';
export function AvatarPicker({value,onChange}:{value:string;onChange:(path:string)=>void}) {
  const picker=useRef<HTMLDetailsElement>(null);
  return <details className="avatar-picker" ref={picker}><summary>{value&&<img className="avatar-art" src={mediaUrl(value)} alt="Ausgewähltes Profilbild"/>}<span>Profilbild auswählen</span><span className="avatar-chevron" aria-hidden="true">⌄</span></summary><div className="avatar-grid" aria-label="Profilbilder">{AVATARS.map((path,i)=><button key={path} type="button" className={path===value?'selected':''} aria-label={`Profilbild ${i+1}`} aria-pressed={path===value} onClick={()=>{onChange(path);if(picker.current)picker.current.open=false;}}><img src={mediaUrl(path)} alt="" loading="lazy"/></button>)}</div></details>;
}
