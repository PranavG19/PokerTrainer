import { createTable, startHand } from "../../src/core/table.js";
const t = startHand(createTable({ seats: [{name:"A",stack:5000,isHero:true},{name:"B",stack:5000},{name:"C",stack:5000},{name:"D",stack:5000}], sb:25, bb:50, seed:7 }));
console.log(t.pot, t.currentBet, t.seats.map(s=>s.hole.join("")));
