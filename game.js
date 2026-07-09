const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const selectScreen = document.getElementById("selectScreen");
const rosterEl = document.getElementById("roster");
const startButton = document.getElementById("startButton");
const roundBanner = document.getElementById("roundBanner");

const W = canvas.width;
const H = canvas.height;
const floorY = 626;

// Figure-free arena backdrop (the two presidents were cut out of the key art
// and are now drawn as playable sprites on top of this plate).
const arenaBg = new Image();
arenaBg.src = "assets/arena-bg.png";
let arenaReady = false;
arenaBg.addEventListener("load", () => {
  arenaReady = true;
});

// Painted character sprites (transparent cut-outs from the original key art).
// nativeSide is the direction the artwork naturally faces (+1 = right, -1 = left)
// so we know when to mirror it to face the opponent.
const SPRITE_H = 340;
const fighterSprites = {};
const spriteSources = {
  washington: { src: "assets/sprites/washington.png", nativeSide: 1 },
  trump: { src: "assets/sprites/trump.png", nativeSide: -1 },
};
Object.entries(spriteSources).forEach(([id, info]) => {
  const img = new Image();
  img.src = info.src;
  const entry = { img, nativeSide: info.nativeSide, ready: false };
  img.addEventListener("load", () => {
    entry.ready = true;
  });
  fighterSprites[id] = entry;
});

// Per-move pose swaps: while a fighter is mid-attack, drawFighterSprite will
// use one of these in place of the idle cutout if one is defined and loaded.
// scale corrects for photos with a much wider stance than the idle cutout
// (e.g. a wide punch or a low duck) so a fixed sprite height doesn't force
// their width out and make the fighter look bigger than in other poses.
const altSpriteSources = {
  washington: {
    light: { src: "assets/sprites/washington-punch.png", nativeSide: 1 },
    heavy: { src: "assets/sprites/washington-kick.png", nativeSide: 1 },
    special: { src: "assets/sprites/washington-swordlunge.png", nativeSide: 1, scale: 0.82 },
    jump: { src: "assets/sprites/washington-jump.png", nativeSide: 1 },
    block: { src: "assets/sprites/washington-duck.png", nativeSide: 1, scale: 0.72 },
    walk: { src: "assets/sprites/washington-walk.png", nativeSide: 1 },
  },
};
const altFighterSprites = {};
Object.entries(altSpriteSources).forEach(([id, moves]) => {
  altFighterSprites[id] = {};
  Object.entries(moves).forEach(([move, info]) => {
    const img = new Image();
    img.src = info.src;
    const entry = { img, nativeSide: info.nativeSide, scale: info.scale || 1, ready: false };
    img.addEventListener("load", () => {
      entry.ready = true;
    });
    altFighterSprites[id][move] = entry;
  });
});

const fighters = [
  {
    id: "washington",
    name: "G. Washington",
    tag: "colonial commander",
    card: "#2c8ed6",
    skin: "#d1a27c",
    hair: "#e7e3da",
    outfit: "#263247",
    accent: "#c9b078",
    special: "Valley Forge Slash",
    stats: { speed: 4.7, power: 1.14, reach: 92 },
  },
  {
    id: "trump",
    name: "D. Trump",
    tag: "oval office brawler",
    card: "#cf2833",
    skin: "#cf8559",
    hair: "#e8c56b",
    outfit: "#242936",
    accent: "#f4f1e8",
    special: "Rally Counter",
    stats: { speed: 4.6, power: 1.18, reach: 86 },
  },
];

let selectedId = fighters[0].id;
let player;
let rival;
let cameraShake = 0;
let hitSparks = [];
let state = "select";
let paused = false;
let roundOver = false;
let timer = 88;
let lastTick = performance.now();
let aiCooldown = 0;
const keys = new Set();

function makeFighter(template, x, side, isPlayer) {
  return {
    ...template,
    x,
    y: floorY,
    vx: 0,
    vy: 0,
    side,
    width: 108,
    height: 270,
    health: 100,
    meter: 24,
    combo: 0,
    comboTimer: 0,
    hitstun: 0,
    block: false,
    attacking: null,
    attackTimer: 0,
    attackLanded: false,
    grounded: true,
    isPlayer,
    bob: Math.random() * Math.PI,
    landSquash: 0,
    wasGrounded: true,
  };
}

function buildRoster() {
  rosterEl.innerHTML = "";
  fighters.forEach((fighter) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `fighter-card ${fighter.id === selectedId ? "selected" : ""}`;
    card.style.setProperty("--card-color", fighter.card);
    card.style.setProperty("--hair", fighter.hair);
    card.style.setProperty("--outfit", fighter.outfit);
    card.innerHTML = `<i class="portrait" aria-hidden="true"></i><strong>${fighter.name}</strong><span>${fighter.tag}</span>`;
    card.addEventListener("click", () => {
      selectedId = fighter.id;
      buildRoster();
    });
    rosterEl.appendChild(card);
  });
}

function startMatch() {
  const chosen = fighters.find((fighter) => fighter.id === selectedId);
  const pool = fighters.filter((fighter) => fighter.id !== selectedId);
  const opponent = chosen.id === "trump" ? fighters[0] : fighters[1];
  window.scrollTo({ top: 0, behavior: "auto" });
  player = makeFighter(chosen, 410, 1, true);
  rival = makeFighter(opponent, 840, -1, false);
  timer = 88;
  state = "fight";
  roundOver = false;
  paused = false;
  lastTick = performance.now();
  selectScreen.classList.add("hidden");
  showBanner("Round 1");
  setTimeout(() => showBanner("Fight!"), 900);
}

function showBanner(text) {
  roundBanner.textContent = text;
  roundBanner.classList.add("show");
  setTimeout(() => roundBanner.classList.remove("show"), 720);
}

function drawBackground() {
  if (arenaReady) {
    drawArena();
    return;
  }

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#151d25");
  sky.addColorStop(0.38, "#1d252a");
  sky.addColorStop(0.72, "#11171a");
  sky.addColorStop(1, "#0b0d0f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = 0.96;
  for (let i = 0; i < 9; i += 1) {
    const x = i * 170 - 70;
    const h = 320 + (i % 3) * 44;
    ctx.fillStyle = i % 2 ? "#222b30" : "#2b2728";
    ctx.fillRect(x, floorY - h, 132, h);
    ctx.fillStyle = "rgba(255, 110, 38, 0.72)";
    ctx.fillRect(x + 22, floorY - h + 72, 18, 74);
    ctx.fillRect(x + 76, floorY - h + 124, 16, 56);
    ctx.fillStyle = "rgba(255, 197, 79, 0.18)";
    ctx.fillRect(x + 20, floorY - h + 72, 74, 74);
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 5; i += 1) {
    const glow = ctx.createRadialGradient(150 + i * 260, 392, 8, 150 + i * 260, 392, 160);
    glow.addColorStop(0, "rgba(46, 194, 255, 0.18)");
    glow.addColorStop(1, "rgba(46, 194, 255, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(150 + i * 260, 392 + Math.sin(performance.now() / 900 + i) * 8, 132, 26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const floor = ctx.createLinearGradient(0, floorY, 0, H);
  floor.addColorStop(0, "#5b4d3f");
  floor.addColorStop(1, "#2f2925");
  ctx.fillStyle = floor;
  ctx.fillRect(0, floorY, W, H - floorY);

  ctx.strokeStyle = "rgba(11, 12, 13, 0.5)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(W, floorY);
  ctx.stroke();

  for (let x = -120; x < W + 160; x += 128) {
    ctx.strokeStyle = "rgba(139, 95, 67, 0.72)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, floorY + 4);
    ctx.lineTo(x + 84, H);
    ctx.stroke();
  }
  for (let y = floorY + 24; y < H; y += 36) {
    ctx.strokeStyle = "rgba(12, 13, 14, 0.34)";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
  ctx.fillRect(0, 0, W, H);
}

function drawArena() {
  const imageRatio = arenaBg.width / arenaBg.height;
  const canvasRatio = W / H;
  let sx = 0;
  let sy = 0;
  let sw = arenaBg.width;
  let sh = arenaBg.height;

  if (imageRatio > canvasRatio) {
    sw = arenaBg.height * canvasRatio;
    sx = (arenaBg.width - sw) / 2;
  } else {
    sh = arenaBg.width / canvasRatio;
    sy = (arenaBg.height - sh) / 2;
  }

  ctx.drawImage(arenaBg, sx, sy, sw, sh, 0, 0, W, H);
  const vignette = ctx.createRadialGradient(W / 2, H * 0.52, 120, W / 2, H * 0.52, W * 0.74);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.68, "rgba(0,0,0,0.04)");
  vignette.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(0, 0, W, 158);
}

function drawHUD() {
  drawRevengeDial(56, 82, player.meter, false);
  drawRevengeDial(W - 56, 82, rival.meter, true);
  drawHealth(112, 34, 448, player.health, player.name, false);
  drawHealth(W - 560, 34, 448, rival.health, rival.name, true);

  ctx.fillStyle = "#111016";
  roundRect(W / 2 - 82, 24, 164, 110, 10);
  ctx.fill();
  ctx.strokeStyle = "#f6efe0";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = "#58252b";
  ctx.lineWidth = 3;
  roundRect(W / 2 - 70, 35, 140, 88, 8);
  ctx.stroke();
  ctx.fillStyle = "#ffdc40";
  ctx.font = "28px Bangers";
  ctx.textAlign = "center";
  ctx.fillText("K.O.", W / 2, 53);
  ctx.fillStyle = "#fff2e4";
  ctx.shadowColor = "#ff404e";
  ctx.shadowBlur = 18;
  ctx.font = "76px Bangers";
  ctx.fillText(String(Math.ceil(timer)).padStart(2, "0"), W / 2, 119);
  ctx.shadowBlur = 0;

  drawSegmentMeter(118, 92, player.meter, false);
  drawSegmentMeter(W - 118, 92, rival.meter, true);
  drawCombo(460, 101, player.combo, false);
  drawCombo(W - 460, 101, rival.combo, true);
  drawPausePlate();

  if (paused) centerText("PAUSE", "#fff2e4", 86);
}

function drawHealth(x, y, width, value, label, flip) {
  ctx.save();
  ctx.fillStyle = "#111319";
  roundRect(x, y, width, 34, 4);
  ctx.fill();
  ctx.strokeStyle = "#e8e4d5";
  ctx.lineWidth = 4;
  ctx.stroke();
  const pct = Math.max(0, value) / 100;
  const bar = (width - 10) * pct;
  const grad = ctx.createLinearGradient(x, y, x + width, y);
  grad.addColorStop(0, flip ? "#fa363e" : "#fff538");
  grad.addColorStop(0.72, flip ? "#ff8b2a" : "#ffb932");
  grad.addColorStop(1, flip ? "#ffdf32" : "#fa363e");
  ctx.fillStyle = grad;
  if (flip) ctx.fillRect(x + width - 5 - bar, y + 5, Math.max(0, bar), 24);
  else ctx.fillRect(x + 5, y + 5, Math.max(0, bar), 24);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  if (flip) ctx.fillRect(x + width - 5 - bar, y + 6, Math.max(0, bar), 7);
  else ctx.fillRect(x + 5, y + 6, Math.max(0, bar), 7);
  ctx.fillStyle = "#f7f2dc";
  ctx.font = "24px Bangers";
  ctx.textAlign = flip ? "right" : "left";
  ctx.strokeStyle = "#0b0d10";
  ctx.lineWidth = 5;
  ctx.strokeText(label, flip ? x + width - 8 : x + 8, y + 62);
  ctx.fillText(label, flip ? x + width - 8 : x + 8, y + 62);
  ctx.restore();
}

function drawSegmentMeter(x, y, meter, flip) {
  const segmentWidth = 66;
  const gap = 10;
  const total = 4 * segmentWidth + 3 * gap;
  const start = flip ? x - total : x;
  for (let i = 0; i < 4; i += 1) {
    const sx = start + i * (segmentWidth + gap);
    ctx.fillStyle = "#0b1117";
    roundRect(sx, y, segmentWidth, 20, 5);
    ctx.fill();
    ctx.strokeStyle = "#aeb5bf";
    ctx.lineWidth = 3;
    ctx.stroke();
    const fill = Math.max(0, Math.min(1, (meter - i * 25) / 25));
    ctx.fillStyle = "#2aa7ff";
    ctx.fillRect(sx + 4, y + 4, (segmentWidth - 8) * fill, 12);
  }
}

function drawCombo(x, y, combo, flip) {
  ctx.fillStyle = "#20d6ff";
  ctx.font = "28px Bangers";
  ctx.textAlign = flip ? "right" : "left";
  ctx.strokeStyle = "#111319";
  ctx.lineWidth = 5;
  ctx.strokeText(`COMBO ${combo}`, x, y + 18);
  ctx.fillText(`COMBO ${combo}`, x, y + 18);
}

function drawPausePlate() {
  ctx.fillStyle = "#f7f2dc";
  roundRect(W / 2 - 65, 140, 130, 42, 6);
  ctx.fill();
  ctx.strokeStyle = "#402024";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#51252a";
  ctx.font = "34px Bangers";
  ctx.textAlign = "center";
  ctx.fillText("PAUSE", W / 2, 173);
}

function drawRevengeDial(x, y, meter, flip) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.fillStyle = "#0c1117";
  ctx.beginPath();
  ctx.arc(0, 0, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#aeb5bf";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = "#42e66c";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(0, 0, 36, -Math.PI * 0.78, -Math.PI * 0.78 + Math.PI * 1.55 * (meter / 100));
  ctx.stroke();
  ctx.fillStyle = "#12151a";
  ctx.beginPath();
  ctx.arc(0, 0, 21, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f7f2dc";
  ctx.font = "18px Bangers";
  ctx.textAlign = "center";
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("REVENGE", 0, -54);
  ctx.restore();
}

function centerText(text, color, size) {
  ctx.fillStyle = color;
  ctx.font = `${size}px Bangers`;
  ctx.textAlign = "center";
  ctx.shadowColor = "#0b0d10";
  ctx.shadowBlur = 4;
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#0b0d10";
  ctx.strokeText(text, W / 2, H / 2);
  ctx.fillText(text, W / 2, H / 2);
  ctx.shadowBlur = 0;
}

function drawFighter(f) {
  const sprite = fighterSprites[f.id];
  if (sprite && sprite.ready) {
    drawFighterSprite(f, sprite);
    return;
  }
  drawFighterVector(f);
}

function drawFighterSprite(f, sprite) {
  const movingForward = f.grounded && f.vx !== 0 && Math.sign(f.vx) === f.side;
  const poseKey = f.attacking
    ? f.attacking
    : f.block
    ? "block"
    : !f.grounded
    ? "jump"
    : movingForward
    ? "walk"
    : null;
  const alt = poseKey && altFighterSprites[f.id] && altFighterSprites[f.id][poseKey];
  const activeSprite = alt && alt.ready ? alt : sprite;
  const img = activeSprite.img;
  const h = SPRITE_H * (activeSprite.scale || 1);
  const w = (img.width * h) / img.height;
  const bob = Math.sin(f.bob) * 3;

  let scaleX = 1;
  let scaleY = 1;
  let rotate = 0;
  let extraX = 0;
  let extraY = 0;

  // walking: lean whole body in the direction of travel
  if (f.grounded && !f.attacking) {
    const walkLean = Math.max(-1, Math.min(1, f.vx / f.stats.speed));
    rotate += walkLean * 0.07;
  }

  // jump: stretch going up, compress coming down
  if (!f.grounded) {
    if (f.vy < 0) {
      scaleY *= 1.1;
      scaleX *= 0.93;
    } else {
      scaleY *= 0.96;
      scaleX *= 1.04;
    }
  }
  if (f.landSquash > 0) {
    scaleY *= 1 - 0.24 * f.landSquash;
    scaleX *= 1 + 0.24 * f.landSquash;
  }

  // block: crouch and lean back on guard
  const squash = f.block ? 0.94 : 1;
  if (f.block) rotate += -f.side * 0.05;

  // attacks: punch/kick lunge with wind-up-and-follow-through arc
  if (f.attacking) {
    const data = attackData(f.attacking);
    const t = Math.min(1, Math.max(0, 1 - f.attackTimer / data.duration));
    const swing = Math.sin(Math.PI * t);
    if (f.attacking === "light") {
      extraX = f.side * swing * 30;
      rotate += f.side * swing * 0.14;
      scaleX *= 1 + swing * 0.06;
    } else if (f.attacking === "heavy") {
      extraX = f.side * swing * 46;
      extraY = -swing * 16;
      rotate += f.side * swing * 0.26;
      scaleX *= 1 + swing * 0.1;
      scaleY *= 1 - swing * 0.05;
    } else if (f.attacking === "special") {
      extraX = f.side * swing * 34;
      rotate += f.side * Math.sin(Math.PI * 2 * t) * 0.3;
      scaleX *= 1 + swing * 0.08;
    }
  }

  // hitstun: snap back from the impact
  if (f.hitstun > 0.001) {
    rotate += -f.side * 0.12;
    scaleX *= 0.95;
  }

  const cx = f.x + extraX;

  // contact shadow
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.beginPath();
  ctx.ellipse(f.x, f.y + 10, w * 0.4, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // special-move aura in front of the lead hand
  if (f.attacking === "special") {
    const gx = f.x + f.side * 96;
    const gy = f.y - 168;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.7;
    const glow = ctx.createRadialGradient(gx, gy, 4, gx, gy, 74);
    glow.addColorStop(0, f.accent);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(gx, gy, 74, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(cx, f.y + 6 + extraY);
  ctx.rotate(rotate);
  ctx.scale(f.side * activeSprite.nativeSide * scaleX, scaleY);
  if (f.hitstun > 0.001) ctx.filter = "brightness(1.7) saturate(1.3)";
  const dh = h * squash;
  ctx.drawImage(img, -w / 2, -dh + bob, w, dh);
  ctx.filter = "none";
  ctx.restore();
}

function drawFighterVector(f) {
  const crouch = f.block ? 24 : 0;
  const x = f.x;
  const y = f.y + Math.sin(f.bob) * 3;
  const facing = f.side;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * 1.08, 1.08);

  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.beginPath();
  ctx.ellipse(0, 12, 96, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  const lean = f.attacking ? 22 : 0;
  const recoil = f.hitstun > 0 ? -18 : 0;
  drawLeg(-32 + recoil, -128 + crouch, -58, -64 + crouch, -82, -12, f.outfit, f.accent, true);
  drawLeg(34 + recoil, -124 + crouch, 48, -58 + crouch, 72, -12, f.outfit, f.accent, false);
  drawTorso(0 + lean + recoil, -246 + crouch, f);
  drawHead(10 + lean + recoil, -322 + crouch, f);
  drawArm(-54 + lean + recoil, -224 + crouch, -92, -182 + crouch, -118, -136 + crouch, f.skin, f.accent, false);

  const reach = f.attacking ? f.stats.reach + 68 + (f.attacking === "heavy" ? 42 : 0) : 94;
  const armY = f.attacking === "special" ? -212 + Math.sin(performance.now() / 45) * 10 : -188;
  const elbowX = f.attacking ? 106 : 82;
  drawArm(56 + lean + recoil, -224 + crouch, elbowX, -200 + crouch, reach, armY + crouch, f.skin, f.accent, true);

  if (f.attacking === "special") {
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = f.accent;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(116, -198 + crouch, 56, -1.18, 1.2);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(116, -198 + crouch, 36, -1.18, 1.2);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawTorso(x, y, f) {
  ctx.save();
  ctx.translate(x, y);
  const bareChest = f.id === "jax";
  const torsoColor = bareChest ? f.skin : f.outfit;
  ctx.strokeStyle = "#080b0f";
  ctx.lineWidth = 8;
  ctx.fillStyle = torsoColor;
  ctx.beginPath();
  ctx.moveTo(-62, 8);
  ctx.quadraticCurveTo(-44, -20, -6, -24);
  ctx.quadraticCurveTo(44, -20, 62, 8);
  ctx.lineTo(42, 138);
  ctx.quadraticCurveTo(0, 154, -44, 138);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  if (bareChest) {
    ctx.strokeStyle = "rgba(84, 38, 30, 0.68)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(0, 118);
    ctx.moveTo(-36, 34);
    ctx.quadraticCurveTo(-14, 48, 0, 38);
    ctx.moveTo(36, 34);
    ctx.quadraticCurveTo(14, 48, 0, 38);
    ctx.moveTo(-26, 75);
    ctx.lineTo(26, 75);
    ctx.moveTo(-24, 99);
    ctx.lineTo(24, 99);
    ctx.stroke();
    ctx.fillStyle = f.outfit;
    ctx.fillRect(-48, 122, 96, 24);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.ellipse(-22, 24, 18, 62, -0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(30, 46, 18, 72, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = f.accent;
    ctx.fillRect(-48, 84, 96, 16);
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.fillRect(-44, 87, 88, 4);
  }
  ctx.restore();
}

function drawHead(x, y, f) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#080b0f";
  ctx.lineWidth = 7;
  ctx.fillStyle = f.hair;
  ctx.beginPath();
  ctx.ellipse(0, 18, 39, 42, -0.08, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = f.skin;
  ctx.beginPath();
  ctx.ellipse(2, 30, 31, 35, -0.08, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.24)";
  ctx.beginPath();
  ctx.ellipse(-12, 18, 9, 17, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#101820";
  ctx.fillRect(10, 20, 7, 6);
  ctx.fillStyle = "#101820";
  ctx.fillRect(-11, 20, 6, 5);
  ctx.fillStyle = "#8b332d";
  ctx.fillRect(0, 46, 21, 5);
  ctx.restore();
}

function drawArm(x1, y1, x2, y2, x3, y3, color, glove, lead) {
  drawLimb(x1, y1, x2, y2, lead ? 23 : 20, color);
  drawLimb(x2, y2, x3, y3, lead ? 22 : 19, color);
  ctx.strokeStyle = "rgba(255,255,255,0.26)";
  ctx.lineWidth = lead ? 6 : 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1 + 4, y1 - 3);
  ctx.lineTo(x2 + 4, y2 - 3);
  ctx.stroke();
  ctx.fillStyle = glove;
  ctx.strokeStyle = "#080b0f";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(x3, y3, lead ? 28 : 23, lead ? 23 : 20, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.32)";
  ctx.beginPath();
  ctx.ellipse(x3 - 8, y3 - 7, 8, 5, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawLeg(x1, y1, x2, y2, x3, y3, color, accent, backFoot) {
  drawLimb(x1, y1, x2, y2, 29, color);
  drawLimb(x2, y2, x3, y3, 27, color);
  ctx.fillStyle = accent;
  ctx.strokeStyle = "#080b0f";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(x3 + (backFoot ? -4 : 8), y3 + 5, 36, 15, backFoot ? -0.12 : 0.12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
}

function drawLimb(x1, y1, x2, y2, width, color) {
  ctx.strokeStyle = "#080b0f";
  ctx.lineWidth = width + 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function update(dt) {
  if (state !== "fight" || paused || roundOver) return;

  timer -= dt;
  if (timer <= 0) endRound(player.health >= rival.health ? player : rival);

  handlePlayerInput();
  handleAI(dt);
  updateFighter(player, dt);
  updateFighter(rival, dt);
  resolveCollision();
  updateSparks(dt);

  if (player.health <= 0) endRound(rival);
  if (rival.health <= 0) endRound(player);
}

function handlePlayerInput() {
  if (player.hitstun > 0) return;
  player.block = keys.has("s");
  player.vx = 0;
  if (keys.has("a")) player.vx = -player.stats.speed;
  if (keys.has("d")) player.vx = player.stats.speed;
  if (keys.has("w") && player.grounded) {
    player.vy = -16;
    player.grounded = false;
  }
}

function handleAI(dt) {
  aiCooldown -= dt;
  rival.side = rival.x > player.x ? -1 : 1;
  const distance = Math.abs(rival.x - player.x);
  if (rival.hitstun > 0) return;
  rival.block = player.attacking && distance < 130 && Math.random() < 0.55;
  rival.vx = 0;
  if (distance > 210) rival.vx = -rival.side * rival.stats.speed * 0.72;
  if (distance < 132) rival.vx = rival.side * rival.stats.speed * 0.48;
  if (aiCooldown <= 0 && distance < 205) {
    const roll = Math.random();
    attack(rival, roll > 0.72 && rival.meter > 32 ? "special" : roll > 0.42 ? "heavy" : "light");
    aiCooldown = 0.7 + Math.random() * 0.65;
  }
}

function updateFighter(f, dt) {
  f.side = f.x > (f.isPlayer ? rival.x : player.x) ? -1 : 1;
  f.bob += dt * (6 + Math.abs(f.vx) * 3);
  f.hitstun = Math.max(0, f.hitstun - dt);
  f.comboTimer = Math.max(0, f.comboTimer - dt);
  if (f.comboTimer === 0) f.combo = 0;
  f.landSquash = Math.max(0, f.landSquash - dt * 4.5);

  if (f.attackTimer > 0) {
    f.attackTimer -= dt;
    if (!f.attackLanded && f.attackTimer < attackData(f.attacking).activeAt) tryHit(f, f.isPlayer ? rival : player);
    if (f.attackTimer <= 0) f.attacking = null;
  }

  f.wasGrounded = f.grounded;
  f.x += f.vx;
  f.vy += 0.85;
  f.y += f.vy;
  f.grounded = false;
  if (f.y >= floorY) {
    f.y = floorY;
    f.vy = 0;
    f.grounded = true;
    if (!f.wasGrounded) f.landSquash = 1;
  }
  f.x = Math.max(145, Math.min(W - 145, f.x));
  f.meter = Math.min(100, f.meter + dt * 3.5);
}

function resolveCollision() {
  const gap = rival.x - player.x;
  const minGap = 150;
  if (Math.abs(gap) < minGap) {
    const push = (minGap - Math.abs(gap)) / 2;
    player.x -= Math.sign(gap || 1) * push;
    rival.x += Math.sign(gap || 1) * push;
  }
}

function attack(f, type) {
  if (f.attacking || f.hitstun > 0) return;
  const data = attackData(type);
  if (type === "special" && f.meter < 35) return;
  if (type === "special") f.meter -= 35;
  f.attacking = type;
  f.attackTimer = data.duration;
  f.attackLanded = false;
}

function attackData(type) {
  return {
    light: { damage: 7, duration: 0.28, activeAt: 0.16, range: 164, stun: 0.24, gain: 11 },
    heavy: { damage: 13, duration: 0.48, activeAt: 0.28, range: 196, stun: 0.38, gain: 16 },
    special: { damage: 18, duration: 0.6, activeAt: 0.36, range: 232, stun: 0.52, gain: 4 },
  }[type];
}

function tryHit(attacker, defender) {
  const data = attackData(attacker.attacking);
  const distance = Math.abs(attacker.x - defender.x);
  const facingTarget = Math.sign(defender.x - attacker.x) === attacker.side;
  attacker.attackLanded = true;
  if (!facingTarget || distance > data.range || Math.abs(attacker.y - defender.y) > 90) return;
  const blocked = defender.block && Math.sign(attacker.x - defender.x) === defender.side;
  const damage = data.damage * attacker.stats.power * (blocked ? 0.28 : 1);
  defender.health = Math.max(0, defender.health - damage);
  defender.hitstun = blocked ? 0.12 : data.stun;
  defender.vx = attacker.side * (blocked ? 7 : 13);
  attacker.combo += blocked ? 0 : 1;
  attacker.comboTimer = 1.8;
  attacker.meter = Math.min(100, attacker.meter + data.gain);
  cameraShake = blocked ? 5 : 12;
  hitSparks.push({ x: defender.x - defender.side * 72, y: defender.y - 190, age: 0, color: blocked ? "#20d6ff" : attacker.accent });
}

function updateSparks(dt) {
  hitSparks.forEach((spark) => {
    spark.age += dt;
  });
  hitSparks = hitSparks.filter((spark) => spark.age < 0.28);
  cameraShake = Math.max(0, cameraShake - dt * 34);
}

function drawSparks() {
  hitSparks.forEach((spark) => {
    const pct = 1 - spark.age / 0.28;
    ctx.save();
    ctx.translate(spark.x, spark.y);
    ctx.globalAlpha = pct;
    ctx.strokeStyle = spark.color;
    ctx.lineWidth = 6;
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 8, Math.sin(angle) * 8);
      ctx.lineTo(Math.cos(angle) * 46 * pct, Math.sin(angle) * 46 * pct);
      ctx.stroke();
    }
    ctx.restore();
  });
}

function endRound(winner) {
  if (roundOver) return;
  roundOver = true;
  showBanner(`${winner.name} Wins`);
  setTimeout(() => {
    state = "select";
    selectScreen.classList.remove("hidden");
  }, 2200);
}

function draw() {
  ctx.save();
  if (cameraShake > 0) {
    ctx.translate((Math.random() - 0.5) * cameraShake, (Math.random() - 0.5) * cameraShake);
  }
  drawBackground();
  if (state === "fight") {
    drawFighter(player.x < rival.x ? player : rival);
    drawFighter(player.x < rival.x ? rival : player);
    drawSparks();
    drawHUD();
    if (roundOver) centerText(player.health > rival.health ? "YOU WIN" : "K.O.", "#ffe04d", 92);
  } else {
    drawAttractMode();
  }
  ctx.restore();
}

function drawAttractMode() {
  const demoA = makeFighter(fighters[0], 410, 1, true);
  const demoB = makeFighter(fighters[1], 870, -1, false);
  demoA.side = 1;
  demoB.side = -1;
  drawFighter(demoA);
  drawFighter(demoB);
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTick) / 1000);
  lastTick = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  keys.add(key);
  if (state !== "fight" || !player) return;
  if (key === "j") attack(player, "light");
  if (key === "k") attack(player, "heavy");
  if (key === "l") attack(player, "special");
  if (key === "p" && state === "fight") paused = !paused;
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

startButton.addEventListener("click", startMatch);
buildRoster();
requestAnimationFrame(loop);
