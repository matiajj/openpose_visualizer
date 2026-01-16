const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const CONF_THRESH = 0.1;
const START_FRAME = 0;
const END_FRAME = 171;
const BONES = [
  [1,0],
  [1,2],[2,3],[3,4],
  [1,5],[5,6],[6,7],
  [1,8],
  [8,9],[9,10],[10,11],
  [8,12],[12,13],[13,14]
];
// Control variables
let lineThickness = 8;
let fps = 30;
let showJoints = true;
let lineColor = "#ffffff";
let dynamicThickness = false;
let started = false;

// Setup controls
const lineThicknessSlider = document.getElementById("lineThickness");
const lineThicknessValue = document.getElementById("lineThicknessValue");
const fpsSlider = document.getElementById("fps");
const fpsValue = document.getElementById("fpsValue");
const showJointsCheckbox = document.getElementById("showJoints");
const lineColorPicker = document.getElementById("lineColor");
const dynamicThicknessCheckbox = document.getElementById("dynamicThickness");

const jsonFilesInput = document.getElementById("jsonFiles");
const loadJsonBtn = document.getElementById("loadJsonBtn");
const statusEl = document.getElementById("status");

lineThicknessSlider.addEventListener("input", (e) => {
  lineThickness = parseInt(e.target.value);
  lineThicknessValue.value = lineThickness;
});
lineThicknessValue.addEventListener("input", (e) => {
  lineThickness = parseInt(e.target.value);
  lineThicknessSlider.value = lineThickness;
});
fpsSlider.addEventListener("input", (e) => {
  fps = parseInt(e.target.value);
  fpsValue.value = fps;
});
fpsValue.addEventListener("input", (e) => {
  fps = parseInt(e.target.value);
  fpsSlider.value = fps;
});
showJointsCheckbox.addEventListener("change", (e) => {
  showJoints = e.target.checked;
});
lineColorPicker.addEventListener("input", (e) => {
  lineColor = e.target.value;
});
dynamicThicknessCheckbox.addEventListener("change", (e) => {
  dynamicThickness = e.target.checked;
});

loadJsonBtn.addEventListener("click", async () => {
  const files = Array.from(jsonFilesInput.files || []);
  if (!files.length) {
    statusEl.textContent = "No JSON files selected";
    return;
  }
  statusEl.textContent = "Loading JSON files...";
  const loaded = await loadJsonFiles(files);
  if (loaded) {
    statusEl.textContent = `Loaded ${frames.length} frames`;
    startLoopIfNeeded();
  } else {
    statusEl.textContent = "Failed to load JSON files";
  }
});



let frames = [];
let frameIndex = 0;
let folder = 'Plotting';

function frameName(i) {
  return `${folder}.json/${folder}_${String(i).padStart(12, "0")}_keypoints.json`;
}

async function loadFrames() {
  for (let i = START_FRAME; i <= END_FRAME; i++) {
    const res = await fetch(frameName(i));
    const json = await res.json();
    frames.push(json.people[0]?.pose_keypoints_2d || null);
  }
}

async function loadJsonFiles(fileList) {
  try {
    // Sort filenames so frames play in order if they are named numerically
    fileList.sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
    const newFrames = [];
    for (const f of fileList) {
      const text = await f.text();
      const json = JSON.parse(text);
      newFrames.push(json.people[0]?.pose_keypoints_2d || null);
    }
    // Replace frames
    frames = newFrames;
    frameIndex = 0;
    return true;
  } catch (e) {
    console.error('loadJsonFiles error', e);
    return false;
  }
}

function startLoopIfNeeded() {
  if (!started && frames.length > 0) {
    started = true;
    requestAnimationFrame(loop);
  }
}

// Calculate scale factor based on body size (torso length)
function getScaleFactor(k) {
  if (!dynamicThickness) return 1.0;
  
  const neckIdx = 1 * 3;
  const midHipIdx = 8 * 3;
  
  if (k[neckIdx+2] >= CONF_THRESH && k[midHipIdx+2] >= CONF_THRESH) {
    const dx = k[midHipIdx] - k[neckIdx];
    const dy = k[midHipIdx+1] - k[neckIdx+1];
    const torsoLength = Math.sqrt(dx*dx + dy*dy);
    
    // Normalize to a reference torso length (adjust based on your videos)
    const referenceTorsoLength = 200; // pixels when person is close
    const scale = torsoLength / referenceTorsoLength;
    
    // Clamp the scale to reasonable bounds
    return Math.max(0.3, Math.min(scale, 2.0));
  }
  
  return 1.0;
}

function drawPose(k) {
  if (!k) return;
  
  const scaleFactor = getScaleFactor(k);
  const currentThickness = lineThickness * scaleFactor;
  
  // HEAD - draw filled circle using ears as diameter
  const neckIdx = 1 * 3;
  const leftEarIdx = 17 * 3;
  const rightEarIdx = 18 * 3;
  
  if (k[leftEarIdx+2] >= CONF_THRESH && k[rightEarIdx+2] >= CONF_THRESH) {
    const centerX = (k[leftEarIdx] + k[rightEarIdx]) / 2;
    const centerY = (k[leftEarIdx+1] + k[rightEarIdx+1]) / 2;
    const dx = k[rightEarIdx] - k[leftEarIdx];
    const dy = k[rightEarIdx+1] - k[leftEarIdx+1];
    const diameter = Math.sqrt(dx*dx + dy*dy);
    const radius = diameter / 2 + currentThickness * 0.5;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI*2);
    ctx.fillStyle = lineColor;
    ctx.fill();
  } else if (k[neckIdx+2] >= CONF_THRESH) {
    const earIdx = k[leftEarIdx+2] >= CONF_THRESH ? leftEarIdx : rightEarIdx;
    if (k[earIdx+2] >= CONF_THRESH) {
      const dx = k[earIdx] - k[neckIdx];
      const dy = k[earIdx+1] - k[neckIdx+1];
      const neckToEar = Math.sqrt(dx*dx + dy*dy);
      const radius = neckToEar * 1.2 + currentThickness * 0.5;
      
      ctx.beginPath();
      ctx.arc(k[earIdx], k[earIdx+1], radius, 0, Math.PI*2);
      ctx.fillStyle = lineColor;
      ctx.fill();
    }
  }
  
  // bones
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = currentThickness;
  ctx.lineCap = "round";
  for (const [a,b] of BONES) {
    // Skip neck bone [1,0]
    if ((a === 1 && b === 0) || (a === 0 && b === 1)) continue;
    
    const ia = a * 3, ib = b * 3;
    if (k[ia+2] < CONF_THRESH || k[ib+2] < CONF_THRESH) continue;
    ctx.beginPath();
    ctx.moveTo(k[ia], k[ia+1]);
    ctx.lineTo(k[ib], k[ib+1]);
    ctx.stroke();
  }
  
  // joints
  if (showJoints) {
    const jointRadius = 4 * scaleFactor;
    for (let i = 0; i < k.length; i += 3) {
      if (k[i+2] < CONF_THRESH) continue;
      ctx.beginPath();
      ctx.arc(k[i], k[i+1], jointRadius, 0, Math.PI*2);
      ctx.fillStyle = "cyan";
      ctx.fill();
    }
  }
}

let lastTime = 0;
function loop(time) {
  if (time - lastTime > 1000 / fps) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPose(frames[frameIndex]);
    frameIndex = (frameIndex + 1) % frames.length;
    lastTime = time;
  }
  requestAnimationFrame(loop);
}

loadFrames().then(() => requestAnimationFrame(loop));
// If the user loads frames later we call startLoopIfNeeded() from handlers above