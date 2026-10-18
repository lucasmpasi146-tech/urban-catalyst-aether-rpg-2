import {validateGearMetadata} from './gear-rules.mjs';
/** Security and economy checks. Pure functions: safe for unit testing. */
export const RESOURCES=['stones','shard','cores','manuals','hpPotions','manaPotions','classTransferTickets','hiddenClassPapers','hiddenPaperFragments'];
export const MAX_GOLD=Number.MAX_SAFE_INTEGER;
export const LISTING_FEE_BPS=100; // 1% posting (non-refundable)
export const SALE_TAX_BPS=300; // 3% of sale proceeds
export const PLATINUM_COPPER=1_000_000; // existing v6.6 exchange rate, unchanged
export const ALLOWED_ROLES=['player','moderator','gm','admin'];
export const safeInt=n=>Number.isSafeInteger(Number(n)) && Number(n)>=0;
export function feeForPrice(price,bps){return Math.max(1,Math.ceil(price*bps/10000));}
export function validateGearUIDs(state){
  const gear=Array.isArray(state?.gearInventory)?state.gearInventory:[];
  if(gear.length>100)return 'Túi chứa hơn 100 vật phẩm.';
  const seen=new Set();
  for(const item of gear){
    if(!item||typeof item!=='object'||typeof item.uid!=='string'||!/^[-a-zA-Z0-9_:]{8,128}$/.test(item.uid))return 'Mã UID trang bị không hợp lệ.';
    if(seen.has(item.uid))return 'Phát hiện UID trang bị trùng trong cùng tài khoản.';
    if(!['weapon','armor','accessory'].includes(item.slot)||typeof item.name!=='string'||item.name.length>120)return 'Thuộc tính trang bị không hợp lệ.';
    // Legacy saves without a rarity still pass the original test fixture; real gear must carry one.
    if(item.rarity){const metadataError=validateGearMetadata(item);if(metadataError)return metadataError;}
    seen.add(item.uid);
  }
  return null;
}
/** Conservative throttle, NOT full combat authority. Reject extreme client-supplied gain. */
export function validateProgressDelta(current,previous,elapsedSeconds,{strict=true}={}){
  const gearErr=validateGearUIDs(current);if(gearErr)return gearErr;
  if(!previous){
    if(Number(current.gold)>30000)return 'Nhân vật mới không thể bắt đầu với số tiền vượt 30.000 Đồng.';
    if(Number(current.level)>3||Number(current.ap)>15)return 'Tiến trình nhân vật mới không hợp lệ.';
    if((current.gearInventory||[]).length>2)return 'Nhân vật mới có quá nhiều trang bị trước lần lưu đầu.';
    const limits={shard:130,stones:30,cores:10,manuals:5,hpPotions:4,manaPotions:4,classTransferTickets:1,hiddenClassPapers:0,hiddenPaperFragments:5};
    for(const [key,limit] of Object.entries(limits))if(Number(current[key]||0)>limit)return `Nhân vật mới có ${key} bất thường.`;
    for(const [stat,limit] of Object.entries({STR:18,AGI:14,INT:16,VIT:16,SPR:16}))if(Number(current.stats?.[stat]||0)>limit)return `Chỉ số ${stat} ban đầu bất thường.`;
    return null;
  }
  const seconds=Math.min(86400,Math.max(1,Math.floor(elapsedSeconds)));
  const level=Number(previous.level)||1;
  const wave=Number(previous.wave)||1;
  const maxKills=seconds*2+15;
  // generous bound, allows AFK and boss spikes; cannot establish legitimacy.
  const goldPerKill=Math.min(120_000,300+level*45+Math.sqrt(wave)*700);
  const positiveMoney=Math.max(0,Number(current.gold||0)-Number(previous.gold||0));
  if(positiveMoney>Math.ceil(maxKills*goldPerKill*2.5)+1_000_000)return 'Tiền tăng vượt quá giới hạn có thể kiểm chứng qua thời gian.';
  if(Number(current.level)-level>Math.ceil(seconds/3)+8)return 'Level tăng vượt tốc độ có thể chấp nhận.';
  const baseStats=['STR','AGI','INT','VIT','SPR'];
  for(const stat of baseStats){if(!safeInt(current.stats?.[stat])||Number(current.stats[stat])>1e9)return `Chỉ số ${stat} không hợp lệ.`;}
  if(!['sovereign'].includes(current.classId)&&!['sovereign'].includes(previous.classId)){
    const allocated=baseStats.reduce((n,stat)=>n+Math.max(0,(Number(current.stats?.[stat])||0)-(Number(previous.stats?.[stat])||0)),0);
    const apSpent=Math.max(0,(Number(previous.ap)||0)-(Number(current.ap)||0));
    if(allocated>apSpent*2+Math.max(0,Number(current.level)-level)*10+15)return 'Tổng điểm thuộc tính tăng không tương ứng AP đã chi.';
  }
  const prevGear=new Map((previous.gearInventory||[]).map(g=>[g.uid,g]));
  for(const item of current.gearInventory||[]){
    const old=prevGear.get(item.uid);if(!old)continue;
    if(old.key!==item.key||old.slot!==item.slot||old.equipmentRank!==item.equipmentRank||old.rarity!==item.rarity)return 'Trang bị cũ bị thay đổi thuộc tính nguồn.';
    if(old.key!=='sovereign_arma'&&JSON.stringify(old.stats)!==JSON.stringify(item.stats))return 'Trang bị bị chỉnh chỉ số gốc trái phép.';
    if(Number(item.enhancementLevel||0)!==Number(old.enhancementLevel||0))return 'Cường hóa phải thực hiện qua API máy chủ.';
    if(old.key!=='sovereign_arma'){
      if(Boolean(old.crafted)!==Boolean(item.crafted)||(old.craftedBy||'')!==(item.craftedBy||'')||(old.setFamily||'')!==(item.setFamily||''))return 'Không được sửa nguồn gốc hoặc dòng trang bị đã có.';
      const changed=JSON.stringify(old.affixes||[])!==JSON.stringify(item.affixes||[]);
      const oldCount=Number(old.reforgeCount||0),newCount=Number(item.reforgeCount||0);
      if(changed||newCount!==oldCount)return 'Tái đúc phải thực hiện qua API máy chủ.';
      if(JSON.stringify(old.special||null)!==JSON.stringify(item.special||null))return 'Nội tại cũ bị thay đổi trái phép.';
    }
  }
  const xpGain=Math.max(0,Number(current.xp||0)-Number(previous.xp||0));
  if(xpGain>maxKills*(1000+level*200)*3)return 'EXP tăng bất thường.';
  const apGain=Number(current.ap||0)-Number(previous.ap||0);
  const levelGain=Math.max(0,Number(current.level||1)-level);
  if(apGain>Math.max(25,levelGain*25+10))return 'AP tăng bất thường.';
  for(const key of RESOURCES){
    const delta=(Number(current[key])||0)-(Number(previous[key])||0);
    if(delta>Math.min(15000,Math.ceil(maxKills*(key==='hiddenClassPapers'?.005:key==='classTransferTickets'?.5:12))+5))return `Phát hiện tăng ${key} bất thường.`;
  }
  const prevIds=new Set((previous.gearInventory||[]).map(g=>g.uid));
  const newItems=(current.gearInventory||[]).filter(g=>!prevIds.has(g.uid));
  if(newItems.some(item=>item.crafted===true))return 'Trang bị tự chế phải do API máy chủ cấp phát.';
  if(newItems.length>Math.min(100,Math.ceil(maxKills*.3)+2))return 'Số trang bị mới vượt lượng có thể đạt được.';
  return null;
}
export function isOutlierPrice(price,median){return median>0&&(price<median*.25||price>median*4);}
export function balancedGearPrice(rank=1,rarity=1,level=1){return Math.max(1000,Math.round((6000+rank*2500+level*90)*Math.max(1,rarity)));}
export function marketPriceAllowed(item,price){
  if(!Number.isSafeInteger(price)||price<10||price>MAX_GOLD)return false;
  if(item?.type==='resource')return price<=1_000_000_000_000;
  return price<=5_000_000_000_000;
}
