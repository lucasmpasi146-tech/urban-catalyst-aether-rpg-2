/* Shared immutable item template and rarity catalog (v6.9). */
export const GEAR_TEMPLATES = {
  rookie_blade:{name:'Kiếm Tân Binh',slot:'weapon',icon:'⚔️',price:42000,requiredLevel:1,stats:{STR:3}},
  plasma_bow:{name:'Cung Plasma',slot:'weapon',icon:'🏹',price:52000,requiredLevel:1,stats:{AGI:3,crit:0.01}},
  star_staff:{name:'Trượng Tinh Tú',slot:'weapon',icon:'🪄',price:56000,requiredLevel:1,stats:{INT:3,MANA:10}},
  guardian_armor:{name:'Giáp Hộ Vệ',slot:'armor',icon:'🛡️',price:49000,requiredLevel:1,stats:{VIT:3,HP:25}},
  aether_robe:{name:'Pháp Bào Aether',slot:'armor',icon:'🥋',price:46000,requiredLevel:1,stats:{INT:2,MANA:25}},
  shadow_cloak:{name:'Áo Choàng Bóng Tối',slot:'armor',icon:'🥷',price:53000,requiredLevel:1,stats:{AGI:2,HP:15}},
  vitality_amulet:{name:'Bùa Sinh Mệnh',slot:'accessory',icon:'📿',price:39000,requiredLevel:1,stats:{HP:35,VIT:1}},
  mana_ring:{name:'Nhẫn Linh Lực',slot:'accessory',icon:'💍',price:43000,requiredLevel:1,stats:{MANA:30,SPR:2}},
  hunter_badge:{name:'Huy Hiệu Thợ Săn',slot:'accessory',icon:'🏅',price:50000,requiredLevel:1,stats:{STR:1,AGI:1,INT:1}},
  rift_edge:{name:'Lưỡi Kiếm Khe Nứt',slot:'weapon',icon:'🗡️',price:72000,requiredLevel:1,stats:{STR:3,crit:0.015}},
  echo_blade:{name:'Kiếm Cộng Hưởng',slot:'weapon',icon:'🔊',price:76000,requiredLevel:1,stats:{STR:2,LUK:2}},
  shadow_dagger:{name:'Song Đao Ảnh Bộ',slot:'weapon',icon:'🔪',price:79000,requiredLevel:1,stats:{AGI:4,crit:0.02}},
  chrono_spear:{name:'Thương Chrono',slot:'weapon',icon:'🔱',price:85000,requiredLevel:1,stats:{STR:2,AGI:2}},
  aether_cannon:{name:'Pháo Aether',slot:'weapon',icon:'💠',price:90000,requiredLevel:1,stats:{INT:4,MANA:15}},
  bastion_core:{name:'Giáp Lõi Thành Trì',slot:'armor',icon:'🦾',price:78000,requiredLevel:1,stats:{VIT:4,HP:45}},
  voidweave_armor:{name:'Giáp Dệt Hư Không',slot:'armor',icon:'🕸️',price:82000,requiredLevel:1,stats:{AGI:2,VIT:2}},
  starlight_mantle:{name:'Mantle Tinh Tú',slot:'armor',icon:'🌠',price:84000,requiredLevel:1,stats:{INT:3,LUK:1,MANA:15}},
  phoenix_plate:{name:'Giáp Phượng Hoàng',slot:'armor',icon:'🔥',price:88000,requiredLevel:1,stats:{VIT:3,HP:30}},
  fortune_charm:{name:'Bùa Thiên Mệnh',slot:'accessory',icon:'🧿',price:68000,requiredLevel:1,stats:{LUK:4}},
  chrono_watch:{name:'Đồng Hồ Thời Không',slot:'accessory',icon:'⌚',price:71000,requiredLevel:1,stats:{AGI:2,LUK:2}},
  void_ring:{name:'Nhẫn Hư Không',slot:'accessory',icon:'🌑',price:74000,requiredLevel:1,stats:{INT:2,crit:0.02}},
  soul_chain:{name:'Dây Chuyền Linh Hồn',slot:'accessory',icon:'🔗',price:77000,requiredLevel:1,stats:{SPR:3,HP:20}},
  hunter_talisman:{name:'Bùa Thợ Săn Tinh Anh',slot:'accessory',icon:'🪬',price:81000,requiredLevel:1,stats:{AGI:2,LUK:3}},
  aether_heart:{name:'Trái Tim Aether',slot:'accessory',icon:'💜',price:95000,requiredLevel:1,stats:{INT:2,VIT:2,MANA:20}},
  sovereign_arma:{name:'ULR · Thần Khí Khai Thiên',slot:'weapon',icon:'🗡️',price:0,requiredLevel:0,noLevelRequirement:true,exclusiveOnly:true,stats:{STR:90,AGI:90,INT:90,VIT:90,SPR:90,HP:600,MANA:500,LUK:44,crit:0.18}}
};

export const GEAR_RANKS = [
  {name:'F',minLevel:1,mult:1.00},
  {name:'E',minLevel:10,mult:1.08},
  {name:'D',minLevel:20,mult:1.16},
  {name:'C',minLevel:35,mult:1.25},
  {name:'B',minLevel:50,mult:1.35},
  {name:'A',minLevel:70,mult:1.47},
  {name:'S',minLevel:100,mult:1.60},
  {name:'SS',minLevel:140,mult:1.74},
  {name:'SSS',minLevel:180,mult:1.89},
  {name:'SR',minLevel:230,mult:2.05},
  {name:'SSR',minLevel:280,mult:2.23},
  {name:'SSSR',minLevel:340,mult:2.42},
  {name:'UR',minLevel:410,mult:2.63},
  {name:'LR',minLevel:480,mult:2.85},
  {name:'ULR',minLevel:501,mult:3.35}
];

export const GEAR_RARITIES = [
  {name:'Thường',mult:1.0,cls:'gear-common'},
  {name:'Tốt',mult:1.35,cls:'gear-uncommon'},
  {name:'Hiếm',mult:1.7,cls:'gear-rare'},
  {name:'Sử thi',mult:2.3,cls:'gear-epic'},
  {name:'Huyền thoại',mult:3.2,cls:'gear-legendary'}
];

export const GEAR_SPECIALS = [
  {id:'fortune',name:'Thiên Mệnh',type:'luck',base:3,desc:'tăng LUK, tỉ lệ rơi đồ, cường hóa và né tránh'},
  {id:'vampiric',name:'Hút Huyết',type:'lifesteal',base:0.025,desc:'hồi HP bằng một phần sát thương gây ra'},
  {id:'evasive',name:'Ảnh Bộ',type:'dodge',base:0.025,desc:'tăng tỉ lệ né đòn nhận vào'},
  {id:'predator',name:'Săn Boss',type:'bossDamage',base:0.06,desc:'tăng sát thương gây lên Boss'},
  {id:'scholar',name:'Tri Thức Aether',type:'xp',base:0.05,desc:'tăng EXP nhận được'},
  {id:'shardling',name:'Tụ Mảnh',type:'shard',base:0.08,desc:'tăng lượng Void Shard nhận được'},
  {id:'regeneration',name:'Tái Sinh',type:'regen',base:0.025,desc:'tăng hồi phục HP tự nhiên'},
  {id:'enchanter',name:'Phù Văn Cường Hóa',type:'enhance',base:0.04,desc:'tăng xác suất cường hóa thành công'},
  {id:'prospector',name:'Thương Nhân May Mắn',type:'coin',base:0.05,desc:'tăng tiền tệ nhận từ săn quái'}
];
