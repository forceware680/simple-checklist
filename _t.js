const r = JSON.parse(require('fs').readFileSync('_r.json','utf8'));
let f=0, t=0, u=0;
for (const x of r.data) {
  if (x.cokok === false) f++;
  else if (x.cokok === true) t++;
  else u++;
}
console.log('false='+f, 'true='+t, 'undefined='+u);
const d = r.data.find(x => x.cokok === false);
console.log('first beda:', d.name, '| selisih.total=', d.selisih.total);
