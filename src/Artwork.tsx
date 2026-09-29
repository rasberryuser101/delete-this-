import { CUSTOM, avatarPath, mediaUrl } from './customization';
type ArtName=Exclude<keyof typeof CUSTOM.art,'avatars'>;
export function Artwork({name,className='',alt=''}:{name:ArtName;className?:string;alt?:string}) {
 return <img className={`artwork ${className}`} src={mediaUrl(CUSTOM.art[name])} alt={alt} draggable={false}/>;
}
export function Avatar({name}:{name:string}) {
 return <img className="avatar-art" src={mediaUrl(avatarPath(name))} alt="" draggable={false}/>;
}
