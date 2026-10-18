/** Gear metadata validator for saves and P2P transfers (v6.9).
 * This is a payload integrity guard. Battle/loot still originate in browser;
 * it is NOT proof that an item was legitimately earned.
 */
export const RARITY_AFFIX_COUNTS=Object.freeze({'Thường':0,'Tốt':1,'Hiếm':2,'Sử thi':3,'Huyền thoại':4});
const AFFIX_STATS=Object.freeze({
 weapon:['STR','AGI','INT','SPR','LUK','crit','HP'],
 armor:['VIT','HP','SPR','AGI','MANA','LUK'],
 accessory:['LUK','INT','AGI','SPR','HP','MANA','crit']
});
const RANK_MULT=Object.freeze({F:1,E:1.08,D:1.16,C:1.25,B:1.35,A:1.47,S:1.6,SS:1.74,SSS:1.89,SR:2.05,SSR:2.23,SSSR:2.42,UR:2.63,LR:2.85,ULR:3.35});
export const gearEnhancementCap=item=>item?.key==='sovereign_arma'||item?.equipmentRank==='ULR'?50:30;

/** Conditional on an enhancement attempt already having failed.
 * The target starts at level 0; failures at +0..+4 never reduce an item's rank.
 * A natural failed roll may leave the rank unchanged, drop 1, or drop 2.
 * Using a protection seal always prevents the downgrade (not the cost/failure).
 */
export function enhancementFailureRisk(level){
 const lv=Math.max(0,Math.min(50,Math.floor(Number(level)||0)));
 if(lv<5)return {loseTwo:0,loseOne:0,retain:1};
 if(lv<10)return {loseTwo:.02,loseOne:.12,retain:.86};
 if(lv<20)return {loseTwo:.08,loseOne:.22,retain:.70};
 if(lv<30)return {loseTwo:.15,loseOne:.32,retain:.53};
 if(lv<40)return {loseTwo:.22,loseOne:.38,retain:.40};
 return {loseTwo:.28,loseOne:.42,retain:.30};
}
/** Pure resolution, with explicit supplied random roll to keep tests reproducible. */
export function resolveEnhancementFailure(level,roll,protectedAttempt=false){
 const previousLevel=Math.max(0,Math.min(50,Math.floor(Number(level)||0)));
 const risk=enhancementFailureRisk(previousLevel);
 const r=Number.isFinite(Number(roll))?Math.max(0,Math.min(.999999999,Number(roll))):.999999999;
 const lostLevels=protectedAttempt?0:r<risk.loseTwo?2:r<risk.loseTwo+risk.loseOne?1:0;
 const resultingLevel=Math.max(0,previousLevel-lostLevels);
 return {previousLevel,level:resultingLevel,lostLevels:previousLevel-resultingLevel,protected:!!protectedAttempt,risk};
}
/** Optional protection payment; uses existing stones/shards; server checks and deducts. */
export function enhancementProtectionCost(level,rankMultiplier=1){
 const lv=Math.max(0,Math.min(50,Math.floor(Number(level)||0)));
 const rank=Math.max(1,Math.min(5,Number(rankMultiplier)||1));
 return {stones:Math.ceil((8+lv*2)*rank),shard:3+Math.floor(lv/5)*3};
}

export const rankAllowed=item=>item?.key==='sovereign_arma'?item?.equipmentRank==='ULR':item?.equipmentRank!=='ULR';
function affixMax(a,item){
 const idx=Object.keys(RARITY_AFFIX_COUNTS).indexOf(item.rarity);
 const base=a.stat==='crit'?.005:a.stat==='HP'?12:a.stat==='MANA'?10:a.stat==='LUK'?1.5:2.5;
 const scalar=(RANK_MULT[item.equipmentRank]||1)*(1+Math.max(0,idx)*.75)*1.22;
 return a.stat==='crit'?.10:Math.ceil(base*scalar)+2;
}
export function validateGearMetadata(item){
 if(!item||typeof item!=='object')return 'Trang bị không phải object.';
 if(!rankAllowed(item))return 'Cấp ULR chỉ dành cho thần khí chủ game.';
 if(!Number.isInteger(Number(item.enhancementLevel||0))||Number(item.enhancementLevel||0)<0||Number(item.enhancementLevel||0)>gearEnhancementCap(item))return 'Cấp cường hóa vượt giới hạn.';
 if(!Object.hasOwn(RARITY_AFFIX_COUNTS,item.rarity))return 'Phẩm chất không hợp lệ.';
 if(item.key==='sovereign_arma'){
  if(!Array.isArray(item.affixes)||item.affixes.length!==7)return 'ULR yêu cầu đủ 7 ấn độc quyền.';
  if(!Array.isArray(item.passives)||item.passives.length!==4)return 'ULR yêu cầu đủ nội tại độc quyền.';
  return null;
 }
 if(item.passives!==undefined&&(!Array.isArray(item.passives)||item.passives.length>0))return 'Nội tại độc quyền không được có trên đồ thường.';
 const affixes=item.affixes??[];
 if(!Array.isArray(affixes)||affixes.length>RARITY_AFFIX_COUNTS[item.rarity])return 'Số ấn phụ vượt số ô phẩm chất.';
 const seen=new Set();
 for(const a of affixes){
  if(!a||typeof a!=='object'||!AFFIX_STATS[item.slot]?.includes(a.stat)||seen.has(a.stat))return 'Ấn phụ không hợp lệ hoặc bị trùng.';
  seen.add(a.stat);
  if(typeof a.value!=='number'||!Number.isFinite(a.value)||a.value<=0||a.value>affixMax(a,item))return 'Giá trị ấn phụ vượt giới hạn phẩm chất/cấp bậc.';
 }
 if(item.reforgeCount!==undefined&&(!Number.isSafeInteger(item.reforgeCount)||item.reforgeCount<0||item.reforgeCount>100000))return 'Số lần tái đúc không hợp lệ.';
 if(item.crafted===true&&(!['basic','refined','mythic'].includes(item.craftTier)||typeof item.craftedBy!=='string'||item.craftedBy.length>25))return 'Dấu vết chế tạo không hợp lệ.';
 if(item.setFamily!==undefined&&item.setFamily!==''&&!['Thiên Tinh','Thâm Uyên','Thủ Hộ','Liệp Ảnh','Aether'].includes(item.setFamily))return 'Dòng trang bị không hợp lệ.';
 return null;
}
