// All money in integer paise. Rates are configurable (default 18).
const P=v=>Math.round((parseFloat(v)||0)*100);
function lineAmount(i){return i.amount!==undefined&&i.amount!==''&&i.amount!==null?P(i.amount):Math.round((parseFloat(i.qty)||0)*P(i.rate))}
function compute(items,{mode='none',interstate=false,discount=0,rate=18}={}){
  const lines=items.map(lineAmount),sub=lines.reduce((a,b)=>a+b,0),dc=Math.min(P(discount),sub),net=sub-dc;
  let taxable=net,tax=0,grand=net;
  if(mode==='ex'){tax=Math.round(net*rate/100);grand=net+tax}
  else if(mode==='in'){taxable=Math.round(net*100/(100+rate));tax=net-taxable}
  const cgst=interstate?0:Math.floor(tax/2),sgst=interstate?0:tax-cgst,igst=interstate?tax:0;
  return{lines,subtotal:sub,discount:dc,taxable,tax,cgst,sgst,igst,grand,words:words(grand)}}
function w(n){const o="One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen".split(" "),t=",,Twenty,Thirty,Forty,Fifty,Sixty,Seventy,Eighty,Ninety".split(",");
  const b=x=>x<20?o[x-1]||"":t[Math.floor(x/10)]+(x%10?" "+o[x%10-1]:""),h=x=>(x>=100?o[Math.floor(x/100)-1]+" Hundred"+(x%100?" ":""):"")+b(x%100);
  const r=[],c=Math.floor(n/1e7),l=Math.floor(n/1e5)%100,k=Math.floor(n/1e3)%100,x=n%1000;
  if(c)r.push(h(c)+" Crore");if(l)r.push(h(l)+" Lakh");if(k)r.push(h(k)+" Thousand");if(x)r.push(h(x));return r.join(" ")||"Zero"}
function words(paise){const r=Math.floor(paise/100),p=paise%100;return"INR "+w(r)+" Rupees"+(p?" and "+w(p)+" Paise":"")+" Only"}
module.exports={compute,words,P};
