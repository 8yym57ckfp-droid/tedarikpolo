function walletScopeRole(){
  const a=currentAdmin();
  return a&&a.role?a.role:'Super Admin';
}

function walletScopeTeamId(){
  const a=currentAdmin();

  if(!a)return null;

  if(
    a.role==='Super Admin'||
    a.role==='Owner'
  ){
    return null;
  }

  return String(a.id);
}

function walletCanManageAll(){
  const role=walletScopeRole();

  return (
    role==='Super Admin'||
    role==='Owner'
  );
}

const PROFILE_KEY='safepays_demo_profiles_v38';
const WALLET_KEY='safepays_wallet_addresses_v43';
const WALLET_SEQ_KEY='safepays_wallet_sequences_v43';

const DEMO_DEFAULT_WALLETS={
  TRC20:'TQ7Jf8mK9x2vL4pN6cR3sW5yH8dG1aZP2',
  ERC20:'0x7A3F8B2C91D4E6F0A5C8B1D739E2F4A6C9D0B812'
};

const DEFAULT_WALLET_LIST=[
  {
    id:'WLT-TRC-01',
    network:'TRC20',
    address:DEMO_DEFAULT_WALLETS.TRC20,
    label:'TRC20 Ana Hesap',
    active:true,
    teamId:'fin-001',
    scopeRole:'Finance',
    createdAt:'2026-09-19T10:00:00+03:00',
    useCount:0,
    lastUsedAt:null
  },
  {
    id:'WLT-ERC-01',
    network:'ERC20',
    address:DEMO_DEFAULT_WALLETS.ERC20,
    label:'ERC20 Ana Hesap',
    active:true,
    teamId:'sup-001',
    scopeRole:'Support',
    createdAt:'2026-09-19T10:00:00+03:00',
    useCount:0,
    lastUsedAt:null
  }
];

function readWalletList(){
  let raw=null;

  try{
    raw=JSON.parse(
      localStorage.getItem(WALLET_KEY)||'null'
    );
  }catch(e){
    raw=null;
  }

  let list=[];

  if(Array.isArray(raw)){
    list=raw.map(x=>({...x}));
  }

  if(
    raw&&
    typeof raw==='object'&&
    !Array.isArray(raw)
  ){
    if(raw.TRC20){
      list.push({
        id:'WLT-TRC-01',
        network:'TRC20',
        address:String(raw.TRC20),
        label:'TRC20 Ana Hesap',
        active:true,
        teamId:'fin-001',
        scopeRole:'Finance',
        createdAt:new Date().toISOString(),
        useCount:0,
        lastUsedAt:null
      });
    }

    if(raw.ERC20){
      list.push({
        id:'WLT-ERC-01',
        network:'ERC20',
        address:String(raw.ERC20),
        label:'ERC20 Ana Hesap',
        active:true,
        teamId:'sup-001',
        scopeRole:'Support',
        createdAt:new Date().toISOString(),
        useCount:0,
        lastUsedAt:null
      });
    }
  }

  /*
    Hiç kayıt yoksa varsayılan cüzdanlar kullanılır.
  */

  if(!list.length){
    list=DEFAULT_WALLET_LIST.map(x=>({
      ...x
    }));
  }

  /*
    ADMIN / OWNER GÖRÜNÜMÜ
  */

  if(currentAdmin()){

    const demoAddresses=new Set(
      Object.values(
        DEMO_DEFAULT_WALLETS
      ).map(x=>String(x).toLowerCase())
    );

    const demoIds=new Set(
      DEFAULT_WALLET_LIST.map(
        x=>String(x.id)
      )
    );

    const realWallets=list.filter(
      w=>
        !demoIds.has(String(w.id))&&
        !demoAddresses.has(
          String(w.address||'')
            .trim()
            .toLowerCase()
        )
    );

    /*
      Gerçek cüzdan varsa demo cüzdanları gizle.
    */

    if(realWallets.length){
      list=realWallets;
    }

    /*
      Owner ve Super Admin her cüzdanı görür.
    */

    if(walletCanManageAll()){
      return list;
    }

    /*
      Normal Admin sadece kendi rolündeki cüzdanları görür.
    */

    const scope=walletScopeRole();

    return list.filter(
      w=>
        String(
          w.scopeRole||''
        )===String(scope)
    );
  }

  /*
    Üye tarafında tüm aktif cüzdanlar kullanılabilir.
  */

  return list;
}

function writeWalletList(list){
  localStorage.setItem(
    WALLET_KEY,
    JSON.stringify(list)
  );

  return list;
}

function readAllWallets(){
  try{
    const raw=JSON.parse(
      localStorage.getItem(
        WALLET_KEY
      )||'[]'
    );

    return Array.isArray(raw)
      ?raw
      :[];
  }catch(e){
    return [];
  }
}

function getWalletList(){
  return readWalletList();
}

function getWalletAddresses(){
  const list=readWalletList();
  const out={};

  ['TRC20','ERC20'].forEach(network=>{

    const active=list.filter(
      w=>
        w.network===network&&
        w.active===true&&
        w.address
    );

    out[network]=
      active.length
        ?active[0].address
        :DEMO_DEFAULT_WALLETS[network];
  });

  return out;
}

function saveWalletAddresses(data){
  const list=readAllWallets();

  Object.keys(
    DEMO_DEFAULT_WALLETS
  ).forEach(network=>{

    if(!data[network])return;

    const address=
      String(
        data[network]
      ).trim();

    const existing=
      list.find(
        w=>w.network===network
      );

    if(existing){

      existing.address=address;
      existing.updatedAt=
        new Date().toISOString();

    }else{

      list.push({
        id:id('WLT'),
        network,
        address,
        label:
          network+' Hesap',
        active:true,
        teamId:
          walletScopeTeamId(),
        scopeRole:
          walletScopeRole(),
        createdAt:
          new Date().toISOString(),
        useCount:0,
        lastUsedAt:null
      });

    }
  });

  writeWalletList(list);

  return getWalletAddresses();
}

function addWalletAddress({
  network,
  address,
  label,
  active=true,
  teamId=null
}){

  if(
    !['TRC20','ERC20']
      .includes(network)
  ){
    throw Error(
      'Geçerli bir ağ seçin.'
    );
  }

  const cleanAddress=
    String(
      address||''
    ).trim();

  if(!cleanAddress){
    throw Error(
      'Cüzdan adresi zorunlu.'
    );
  }

  const team=
    teamId
      ?teamById(teamId)
      :null;

  if(
    teamId&&
    !team
  ){
    throw Error(
      'Geçerli bir ekip seçin.'
    );
  }

  const scope=
    walletScopeRole();

  /*
    Owner + Super Admin tüm ekipleri yönetebilir.
  */

  if(
    !walletCanManageAll()&&
    team&&
    String(team.role)!==
    String(scope)
  ){
    throw Error(
      'Bu ekibe cüzdan atama yetkiniz yok.'
    );
  }

  const list=
    readAllWallets();

  const normalized=
    cleanAddress.toLowerCase();

  /*
    GERÇEK DUPLICATE KONTROLÜ
  */

  const duplicate=
    list.some(
      w=>
        String(
          w.address||''
        )
        .trim()
        .toLowerCase()===
        normalized
    );

  if(duplicate){
    throw Error(
      'Bu adres zaten kayıtlı.'
    );
  }

  const wallet={
    id:id('WLT'),

    network,

    address:
      cleanAddress,

    label:
      String(
        label||
        network+' Hesap'
      ).trim(),

    active:
      Boolean(active),

    teamId:
      team
        ?String(team.id)
        :(walletCanManageAll()
          ?null
          :walletScopeTeamId()),

    scopeRole:
      team
        ?String(team.role)
        :scope,

    createdAt:
      new Date().toISOString(),

    useCount:0,

    lastUsedAt:null
  };

  list.push(wallet);

  writeWalletList(list);

  return wallet;
}

function updateWalletAddress(
  walletId,
  patch
){

  const list=
    readAllWallets();

  const wallet=
    list.find(
      w=>
        String(w.id)===
        String(walletId)
    );

  if(!wallet){
    throw Error(
      'Cüzdan bulunamadı.'
    );
  }

  const scope=
    walletScopeRole();

  if(
    !walletCanManageAll()&&
    String(
      wallet.scopeRole||
      'Super Admin'
    )!==String(scope)
  ){
    throw Error(
      'Bu cüzdan hesabına erişim yetkiniz yok.'
    );
  }

  if(
    patch.address
  ){

    const address=
      String(
        patch.address
      ).trim();

    const duplicate=
      list.some(
        w=>
          String(w.id)!==
          String(walletId)&&
          String(
            w.address||''
          )
          .trim()
          .toLowerCase()===
          address.toLowerCase()
      );

    if(duplicate){
      throw Error(
        'Bu adres zaten kayıtlı.'
      );
    }

    patch={
      ...patch,
      address
    };
  }

  if(
    Object.prototype
      .hasOwnProperty
      .call(
        patch,
        'teamId'
      )
  ){

    const team=
      patch.teamId
        ?teamById(
          patch.teamId
        )
        :null;

    if(
      patch.teamId&&
      !team
    ){
      throw Error(
        'Geçerli bir ekip seçin.'
      );
    }

    if(
      !walletCanManageAll()&&
      team&&
      String(team.role)!==
      String(scope)
    ){
      throw Error(
        'Bu ekibe cüzdan atama yetkiniz yok.'
      );
    }

    patch={
      ...patch,

      teamId:
        team
          ?String(team.id)
          :(walletCanManageAll()
            ?null
            :walletScopeTeamId()),

      scopeRole:
        team
          ?String(team.role)
          :scope
    };
  }

  Object.assign(
    wallet,
    patch
  );

  wallet.updatedAt=
    new Date().toISOString();

  writeWalletList(list);

  return wallet;
}

function toggleWalletAddress(
  walletId,
  active
){
  return updateWalletAddress(
    walletId,
    {
      active:Boolean(active)
    }
  );
}

function deleteWalletAddress(
  walletId
){

  const list=
    readAllWallets();

  const wallet=
    list.find(
      w=>
        String(w.id)===
        String(walletId)
    );

  if(!wallet){
    throw Error(
      'Cüzdan bulunamadı.'
    );
  }

  const scope=
    walletScopeRole();

  if(
    !walletCanManageAll()&&
    String(
      wallet.scopeRole||
      'Super Admin'
    )!==String(scope)
  ){
    throw Error(
      'Bu cüzdan hesabına erişim yetkiniz yok.'
    );
  }

  writeWalletList(
    list.filter(
      w=>
        String(w.id)!==
        String(walletId)
    )
  );

  return wallet;
}
