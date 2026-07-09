const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const selectScreen = document.getElementById("selectScreen");
const rosterEl = document.getElementById("roster");
const startButton = document.getElementById("startButton");
const roundBanner = document.getElementById("roundBanner");
const battleUI = document.getElementById("battleUI");
const actionMenu = document.getElementById("actionMenu");
const moveButtons = Array.from(document.querySelectorAll(".move-btn"));

const W = canvas.width;
const H = canvas.height;
const floorY = 626;
const leftX = 410;
const rightX = 870;

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

// Per-move pose swaps: while a fighter's turn animation is playing, drawFighterSprite
// will use one of these in place of the idle cutout if one is defined and loaded.
// scale corrects for photos with a much wider stance than the idle cutout
// (e.g. a wide punch or a low duck) so a fixed sprite height doesn't force
// their width out and make the fighter look bigger than in other poses.
const altSpriteSources = {
  washington: {
    light: { src: "assets/sprites/washington-punch.png", nativeSide: 1 },
    heavy: { src: "assets/sprites/washington-kick.png", nativeSide: 1 },
    special: { src: "assets/sprites/washington-swordlunge.png", nativeSide: 1, scale: 0.82 },
    block: { src: "assets/sprites/washington-duck.png", nativeSide: 1, scale: 0.72 },
    hit: { src: "assets/sprites/washington-takinghit.png", nativeSide: 1 },
    celebration: { src: "assets/sprites/washington-celebration.png", nativeSide: 1 },
    victory: { src: "assets/sprites/washington-victory-trump.png", nativeSide: 1, vs: "trump" },
  },
  trump: {
    light: { src: "assets/sprites/trump-punch.png", nativeSide: -1 },
    heavy: { src: "assets/sprites/trump-kick.png", nativeSide: -1 },
    special: { src: "assets/sprites/trump-hatswing.png", nativeSide: -1 },
    block: { src: "assets/sprites/trump-block.png", nativeSide: -1 },
    hit: { src: "assets/sprites/trump-takinghit.png", nativeSide: -1 },
    celebration: { src: "assets/sprites/trump-celebration.png", nativeSide: -1 },
    victory: { src: "assets/sprites/trump-victory-washington.png", nativeSide: -1, vs: "washington" },
  },
};
const altFighterSprites = {};
Object.entries(altSpriteSources).forEach(([id, moves]) => {
  altFighterSprites[id] = {};
  Object.entries(moves).forEach(([move, info]) => {
    const img = new Image();
    img.src = info.src;
    const entry = { img, nativeSide: info.nativeSide, scale: info.scale || 1, vs: info.vs || null, ready: false };
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
    stats: { speed: 4.7, power: 1.14 },
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
    stats: { speed: 4.6, power: 1.18 },
  },
];

const MOVE_LABELS = {
  light: "Jab",
  heavy: "Heavy Strike",
  special: null, // filled in per-fighter with their special name
  block: "Guard",
};

let selectedId = fighters[0].id;
let player;
let rival;
let cameraShake = 0;
let hitSparks = [];
let impactTexts = [];
let screenFlash = 0;
let hitStopTimer = 0;
let koAnimStart = 0;
let state = "select";
let turnLocked = false;
let roundOver = false;
let lastTick = performance.now();

function moveData(type) {
  return {
    light: { damage: 9, duration: 0.5, activeAt: 0.52, gain: 12, label: "Jab" },
    heavy: { damage: 16, duration: 0.62, activeAt: 0.56, gain: 16, label: "Heavy Strike" },
    special: { damage: 24, duration: 0.75, activeAt: 0.6, gain: 0, label: null },
  }[type];
}

function makeFighter(template, x, side, isPlayer) {
  return {
    ...template,
    x,
    y: floorY,
    side,
    health: 100,
    displayHealth: 100,
    meter: 24,
    displayMeter: 24,
    isPlayer,
    bob: Math.random() * Math.PI,
    hitFlash: 0,
    knockback: 0,
    won: false,
    anim: null,
    guarding: false,
    moveThisTurn: null,
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
  const opponent = chosen.id === "trump" ? fighters[0] : fighters[1];
  window.scrollTo({ top: 0, behavior: "auto" });
  player = makeFighter(chosen, leftX, 1, true);
  rival = makeFighter(opponent, rightX, -1, false);
  state = "fight";
  roundOver = false;
  turnLocked = false;
  updateSpecialButtonLabel();
  setMenuEnabled(true);
  selectScreen.classList.add("hidden");
  battleUI.classList.remove("hidden");
  showBanner("Round 1");
  setTimeout(() => showBanner("Fight!"), 900);
}

function updateSpecialButtonLabel() {
  const btn = moveButtons.find((b) => b.dataset.move === "special");
  if (btn) btn.textContent = player.special;
}

function showBanner(text) {
  roundBanner.textContent = text;
  roundBanner.classList.add("show");
  setTimeout(() => roundBanner.classList.remove("show"), 720);
}

function setMenuEnabled(enabled) {
  moveButtons.forEach((btn) => {
    const isSpecial = btn.dataset.move === "special";
    const specialLocked = isSpecial && player && player.meter < 35;
    btn.disabled = !enabled || specialLocked;
  });
}

function chooseAiMove() {
  if (rival.health < 30 && Math.random() < 0.32) return "block";
  const roll = Math.random();
  if (roll > 0.72 && rival.meter >= 35) return "special";
  if (roll > 0.42) return "heavy";
  return "light";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function guardBeat(fighter) {
  fighter.guarding = true;
  await wait(360);
}

function performAttack(attacker, defender, type) {
  const data = moveData(type);
  attacker.anim = { type, start: performance.now(), duration: data.duration * 1000 };
  return new Promise((resolve) => {
    setTimeout(() => {
      const blocked = defender.moveThisTurn === "block";
      const dmg = data.damage * attacker.stats.power * (blocked ? 0.28 : 1);
      const lethal = !blocked && defender.health - dmg <= 0;
      defender.health = Math.max(0, defender.health - dmg);
      defender.hitFlash = 1;
      defender.knockback = blocked ? 10 : type === "special" ? 40 : type === "heavy" ? 32 : 26;
      attacker.meter = Math.min(100, attacker.meter + data.gain);
      if (type === "special") attacker.meter = Math.max(0, attacker.meter - 35);

      const bigHit = !blocked && (type === "heavy" || type === "special");
      cameraShake = blocked ? 5 : type === "special" ? 22 : type === "heavy" ? 15 : 9;
      if (bigHit) screenFlash = type === "special" ? 0.55 : 0.35;
      hitStopTimer = blocked ? 0 : type === "special" ? 130 : type === "heavy" ? 85 : 0;

      hitSparks.push({
        x: defender.x - defender.side * 72,
        y: defender.y - 190,
        age: 0,
        color: blocked ? "#20d6ff" : attacker.accent,
        big: bigHit,
      });

      if (bigHit && !lethal) {
        impactTexts.push({
          x: defender.x - defender.side * 40,
          y: defender.y - 260,
          age: 0,
          text: type === "special" ? "CRITICAL!" : "BIG HIT!",
          color: type === "special" ? "#ff404e" : "#ffb932",
        });
      }
      if (lethal) {
        cameraShake = 30;
        screenFlash = 0.85;
        hitStopTimer = 260;
        impactTexts.push({
          x: defender.x - defender.side * 40,
          y: defender.y - 260,
          age: 0,
          text: "K.O.!",
          color: "#ffe04d",
        });
      }
    }, data.activeAt * data.duration * 1000);
    setTimeout(() => {
      attacker.anim = null;
      resolve();
    }, data.duration * 1000 + 160);
  });
}

async function runTurn(playerMove) {
  if (turnLocked || roundOver || state !== "fight") return;
  if (playerMove === "special" && player.meter < 35) return;

  turnLocked = true;
  setMenuEnabled(false);

  const rivalMove = chooseAiMove();
  player.moveThisTurn = playerMove;
  rival.moveThisTurn = rivalMove;
  player.guarding = false;
  rival.guarding = false;

  const actors = [player, rival].sort((a, b) => b.stats.speed - a.stats.speed);

  for (const actor of actors) {
    if (actor.health <= 0) continue;
    const defender = actor === player ? rival : player;
    if (actor.moveThisTurn === "block") {
      await guardBeat(actor);
      continue;
    }
    await performAttack(actor, defender, actor.moveThisTurn);
    if (defender.health <= 0) break;
  }

  player.guarding = false;
  rival.guarding = false;
  player.moveThisTurn = null;
  rival.moveThisTurn = null;
  player.meter = Math.min(100, player.meter + 4);
  rival.meter = Math.min(100, rival.meter + 4);

  if (player.health <= 0 || rival.health <= 0) {
    endRound(player.health > rival.health ? player : rival);
    return;
  }

  turnLocked = false;
  setMenuEnabled(true);
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
  drawRevengeDial(56, 82, player.displayMeter, false);
  drawRevengeDial(W - 56, 82, rival.displayMeter, true);
  drawHealth(112, 34, 448, player.displayHealth, player.name, false);
  drawHealth(W - 560, 34, 448, rival.displayHealth, rival.name, true);
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
  ctx.strokeStyle = meter >= 35 ? "#42e66c" : "#5a6472";
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
  ctx.fillText("SPECIAL", 0, -54);
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

function drawFighter(f, opponent) {
  const sprite = fighterSprites[f.id];
  if (sprite && sprite.ready) {
    drawFighterSprite(f, sprite, opponent);
    return;
  }
  drawFighterVector(f, opponent);
}

function hasVictoryPoseOver(f, opponent) {
  return Boolean(
    opponent &&
      altFighterSprites[f.id] &&
      altFighterSprites[f.id].victory &&
      altFighterSprites[f.id].victory.vs === opponent.id
  );
}

function drawFighterSprite(f, sprite, opponent) {
  const hasVictoryPose = hasVictoryPoseOver(f, opponent);
  const poseKey = f.won
    ? hasVictoryPose
      ? "victory"
      : "celebration"
    : f.anim
      ? f.anim.type
      : f.guarding
        ? "block"
        : f.hitFlash > 0.4
          ? "hit"
          : null;
  const alt = poseKey && altFighterSprites[f.id] && altFighterSprites[f.id][poseKey];
  const activeSprite = alt && alt.ready ? alt : sprite;
  const isVictory = poseKey === "victory" && activeSprite === alt;
  const img = activeSprite.img;
  const h = SPRITE_H * (activeSprite.scale || 1) * (isVictory ? 1.85 : 1);
  const w = (img.width * h) / img.height;
  const bob = isVictory ? 0 : Math.sin(f.bob) * 3;

  let scaleX = 1;
  let scaleY = 1;
  let rotate = 0;
  let extraX = 0;
  let extraY = 0;

  const squash = f.guarding ? 0.94 : 1;
  if (f.guarding) rotate += -f.side * 0.05;

  // attacks: fighter closes the gap and lunges into the opponent, then
  // recoils back to their spot, following a wind-up-and-follow-through arc.
  const gap = opponent ? Math.abs(opponent.x - f.x) : 460;
  if (f.anim) {
    const elapsed = (performance.now() - f.anim.start) / f.anim.duration;
    const t = Math.min(1, Math.max(0, elapsed));
    const swing = Math.sin(Math.PI * t);
    if (f.anim.type === "light") {
      const travel = Math.max(40, gap - 150);
      extraX = f.side * swing * travel;
      rotate += f.side * swing * 0.14;
      scaleX *= 1 + swing * 0.06;
    } else if (f.anim.type === "heavy") {
      const travel = Math.max(40, gap - 120);
      extraX = f.side * swing * travel;
      extraY = -swing * 16;
      rotate += f.side * swing * 0.26;
      scaleX *= 1 + swing * 0.1;
      scaleY *= 1 - swing * 0.05;
    } else if (f.anim.type === "special") {
      const travel = Math.max(40, gap - 100);
      extraX = f.side * swing * travel;
      rotate += f.side * Math.sin(Math.PI * 2 * t) * 0.3;
      scaleX *= 1 + swing * 0.08;
    }
  }

  // hitstun flash: snap back from the impact, knocked away from the attacker
  if (f.hitFlash > 0.001) {
    rotate += -f.side * 0.12;
    scaleX *= 0.95;
  }
  if (f.knockback > 0.001) {
    extraX += -f.side * f.knockback;
  }

  const cx = isVictory ? W / 2 : f.x + extraX;
  const groundY = isVictory ? floorY + 30 : f.y;

  // contact shadow
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 10, w * (isVictory ? 0.26 : 0.4), isVictory ? 22 : 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // special-move aura in front of the lead hand
  if (f.anim && f.anim.type === "special") {
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
  ctx.translate(cx, groundY + 6 + extraY);
  ctx.rotate(rotate);
  ctx.scale((isVictory ? 1 : f.side) * activeSprite.nativeSide * scaleX, scaleY);
  if (f.hitFlash > 0.001) ctx.filter = `brightness(${1 + f.hitFlash * 0.7}) saturate(1.3)`;
  const dh = h * squash;
  ctx.drawImage(img, -w / 2, -dh + bob, w, dh);
  ctx.filter = "none";
  ctx.restore();
}

function drawFighterVector(f, opponent) {
  const crouch = f.guarding ? 24 : 0;
  const gap = opponent ? Math.abs(opponent.x - f.x) : 460;
  let lungeX = 0;
  if (f.anim) {
    const elapsed = (performance.now() - f.anim.start) / f.anim.duration;
    const t = Math.min(1, Math.max(0, elapsed));
    const swing = Math.sin(Math.PI * t);
    const buffer = f.anim.type === "light" ? 150 : f.anim.type === "heavy" ? 120 : 100;
    lungeX = f.side * swing * Math.max(40, gap - buffer);
  }
  const knockX = f.knockback > 0.001 ? -f.side * f.knockback : 0;
  const x = f.x + lungeX + knockX;
  const y = f.y + Math.sin(f.bob) * 3;
  const facing = f.side;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * 1.08, 1.08);

  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.beginPath();
  ctx.ellipse(0, 12, 96, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  const lean = f.anim ? 22 : 0;
  const recoil = f.hitFlash > 0 ? -18 : 0;
  drawLeg(-32 + recoil, -128 + crouch, -58, -64 + crouch, -82, -12, f.outfit, f.accent, true);
  drawLeg(34 + recoil, -124 + crouch, 48, -58 + crouch, 72, -12, f.outfit, f.accent, false);
  drawTorso(0 + lean + recoil, -246 + crouch, f);
  drawHead(10 + lean + recoil, -322 + crouch, f);
  drawArm(-54 + lean + recoil, -224 + crouch, -92, -182 + crouch, -118, -136 + crouch, f.skin, f.accent, false);

  const reach = f.anim ? 94 + 68 + (f.anim.type === "heavy" ? 42 : 0) : 94;
  const armY = f.anim && f.anim.type === "special" ? -212 + Math.sin(performance.now() / 45) * 10 : -188;
  const elbowX = f.anim ? 106 : 82;
  drawArm(56 + lean + recoil, -224 + crouch, elbowX, -200 + crouch, reach, armY + crouch, f.skin, f.accent, true);

  if (f.anim && f.anim.type === "special") {
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
  ctx.strokeStyle = "#080b0f";
  ctx.lineWidth = 8;
  ctx.fillStyle = f.outfit;
  ctx.beginPath();
  ctx.moveTo(-62, 8);
  ctx.quadraticCurveTo(-44, -20, -6, -24);
  ctx.quadraticCurveTo(44, -20, 62, 8);
  ctx.lineTo(42, 138);
  ctx.quadraticCurveTo(0, 154, -44, 138);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
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

// Cosmetic-only per-frame tick: idle bob, hit-flash decay, camera shake decay,
// and a health/meter-bar lerp toward the true values. No physics, no input
// polling, no collision -- the actual fight logic lives in runTurn().
function tick(dt) {
  if (hitStopTimer > 0) {
    hitStopTimer -= dt * 1000;
    return;
  }
  [player, rival].forEach((f) => {
    if (!f) return;
    f.bob += dt * 5;
    f.hitFlash = Math.max(0, f.hitFlash - dt * 3);
    f.knockback = Math.max(0, f.knockback - dt * 90);
    f.displayHealth += (f.health - f.displayHealth) * Math.min(1, dt * 6);
    f.displayMeter += (f.meter - f.displayMeter) * Math.min(1, dt * 6);
  });
  screenFlash = Math.max(0, screenFlash - dt * 2.6);
  updateSparks(dt);
  updateImpactTexts(dt);
  if (state === "fight" && player && !turnLocked) setMenuEnabled(true);
}

function updateImpactTexts(dt) {
  impactTexts.forEach((t) => {
    t.age += dt;
  });
  impactTexts = impactTexts.filter((t) => t.age < 0.6);
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
    const rays = spark.big ? 12 : 8;
    const reach = spark.big ? 68 : 46;
    ctx.save();
    ctx.translate(spark.x, spark.y);
    ctx.globalAlpha = pct;
    ctx.strokeStyle = spark.color;
    ctx.lineWidth = spark.big ? 8 : 6;
    for (let i = 0; i < rays; i += 1) {
      const angle = (Math.PI * 2 * i) / rays;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 8, Math.sin(angle) * 8);
      ctx.lineTo(Math.cos(angle) * reach * pct, Math.sin(angle) * reach * pct);
      ctx.stroke();
    }
    ctx.restore();
  });
}

function drawImpactTexts() {
  impactTexts.forEach((t) => {
    const p = t.age / 0.6;
    const pop = Math.min(1, p / 0.22);
    const scale = 0.5 + Math.sin(pop * Math.PI * 0.5) * 0.9;
    ctx.save();
    ctx.translate(t.x, t.y - p * 46);
    ctx.scale(scale, scale);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, p - 0.55) / 0.45);
    ctx.font = "46px Bangers";
    ctx.textAlign = "center";
    ctx.strokeStyle = "#0b0d10";
    ctx.lineWidth = 8;
    ctx.strokeText(t.text, 0, 0);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, 0, 0);
    ctx.restore();
  });
}

function drawScreenFlash() {
  if (screenFlash <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(255, 245, 220, ${Math.min(0.85, screenFlash)})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function endRound(winner) {
  if (roundOver) return;
  roundOver = true;
  setMenuEnabled(false);
  winner.won = true;
  winner.anim = null;
  koAnimStart = performance.now();
  showBanner(`${winner.name} Wins`);
  setTimeout(() => {
    state = "select";
    selectScreen.classList.remove("hidden");
    battleUI.classList.add("hidden");
  }, 2200);
}

function draw() {
  ctx.save();
  if (cameraShake > 0) {
    ctx.translate((Math.random() - 0.5) * cameraShake, (Math.random() - 0.5) * cameraShake);
  }
  drawBackground();
  if (state === "fight") {
    const hideRival = roundOver && player.won && hasVictoryPoseOver(player, rival);
    const hidePlayer = roundOver && rival.won && hasVictoryPoseOver(rival, player);
    if (!hidePlayer) drawFighter(player, rival);
    if (!hideRival) drawFighter(rival, player);
    drawSparks();
    drawImpactTexts();
    drawScreenFlash();
    drawHUD();
    if (roundOver) drawKoBanner();
  } else {
    drawAttractMode();
  }
  ctx.restore();
}

function drawKoBanner() {
  const elapsed = (performance.now() - koAnimStart) / 1000;
  const pop = Math.min(1, elapsed / 0.32);
  const overshoot = Math.sin(pop * Math.PI) * 0.28 * (1 - pop * 0.6);
  const scale = 0.3 + pop * 0.7 + overshoot;
  const shakeAmt = Math.max(0, 1 - elapsed / 0.4) * 6;
  const jitterX = (Math.random() - 0.5) * shakeAmt;
  const jitterY = (Math.random() - 0.5) * shakeAmt;
  ctx.save();
  ctx.translate(W / 2 + jitterX, H / 2 + jitterY);
  ctx.scale(scale, scale);
  ctx.translate(-W / 2, -H / 2);
  centerText(player.health > rival.health ? "YOU WIN" : "K.O.", "#ffe04d", 92);
  ctx.restore();
}

function drawAttractMode() {
  const demoA = makeFighter(fighters[0], leftX, 1, true);
  const demoB = makeFighter(fighters[1], rightX, -1, false);
  drawFighter(demoA, demoB);
  drawFighter(demoB, demoA);
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTick) / 1000);
  lastTick = now;
  tick(dt);
  draw();
  requestAnimationFrame(loop);
}

moveButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (state !== "fight" || turnLocked || roundOver) return;
    runTurn(btn.dataset.move);
  });
});

window.addEventListener("keydown", (event) => {
  if (state !== "fight" || turnLocked || roundOver) return;
  const key = event.key.toLowerCase();
  if (key === "j") runTurn("light");
  if (key === "k") runTurn("heavy");
  if (key === "l") runTurn("special");
  if (key === " " || key === "s") runTurn("block");
});

startButton.addEventListener("click", startMatch);
buildRoster();
requestAnimationFrame(loop);
