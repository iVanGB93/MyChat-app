import {Platform} from 'react-native';
import {requireOptionalNativeModule} from 'expo';
export type PhoneNetworkInfo={connected:boolean;transport:string;validated:boolean;metered:boolean;interfaceName:string|null;addresses:string[];gateways:string[];dns:string[];mtu:number|null};
const native=Platform.OS==='android'?requireOptionalNativeModule<{phoneNetworkInfo?():Promise<PhoneNetworkInfo>}>('AxonicNearby'):null;
/** Local OS snapshot only: no public-IP service or network probes. */
export async function phoneNetworkInfo():Promise<PhoneNetworkInfo|null>{
 try{return await native?.phoneNetworkInfo?.()??null;}catch{return null;}
}
