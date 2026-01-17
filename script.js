
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const CONF_THRESH = 0.1;
const HAND_CONF_THRESH = 0.1;
const START_FRAME = 0;
let END_FRAME = 0;

const BONES = [
  [1,0],
  [1,2],[2,3],[3,4],
  [1,5],[5,6],[6,7],
  [1,8],
  [8,9],[9,10],[10,11],
  [8,12],[12,13],[13,14]
];

const HAND_BONES = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20]
];

let lineThickness = 8;
let fps = 30;
let showJoints = true;
let lineColor = "#ffffff";
let dynamicThickness = false;
let started = false;

const lineThicknessSlider = document.getElementById("lineThickness");
const lineThicknessValue = document.getElementById("lineThicknessValue");
const fpsSlider = document.getElementById("fps");
const fpsValue = document.getElementById("fpsValue");
const showJointsCheckbox = document.getElementById("showJoints");
const lineColorPicker = document.getElementById("lineColor");
const dynamicThicknessCheckbox = document.getElementById("dynamicThickness");

const jsonFilesInput = document.getElementById("jsonFiles");
const loadAndExportBtn = document.getElementById("loadAndExportBtn");
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

loadAndExportBtn.addEventListener("click", async () => {
  let files = Array.from(jsonFilesInput.files || []);
  files = files.filter(f => f.name.toLowerCase().endsWith('.json'));
  if (!files.length) {
    statusEl.textContent = "No JSON files selected in folder";
    return;
  }
  
  loadAndExportBtn.disabled = true;
  statusEl.textContent = "Loading JSON files from folder...";
  
  const loaded = await loadJsonFiles(files);
  if (loaded) {
    statusEl.textContent = `Loaded ${frames.length} frames. Starting export...`;
    startLoopIfNeeded();
    
    // Wait a moment for the animation to start
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Start export automatically
    await exportVideoMP4();
  } else {
    statusEl.textContent = "Failed to load JSON files";
    loadAndExportBtn.disabled = false;
  }
});

let frames = [];
let frameIndex = 0;

async function loadJsonFiles(fileList) {
  try {
    fileList = fileList.filter(f => f.name.toLowerCase().endsWith('.json'));
    const getKey = (f) => (f.webkitRelativePath || f.name || "");
    fileList.sort((a,b) => getKey(a).localeCompare(getKey(b), undefined, {numeric:true}));
    const newFrames = [];
    for (const f of fileList) {
      try {
        const text = await f.text();
        const json = JSON.parse(text);
        const p = json.people && json.people[0] ? json.people[0] : {};
        newFrames.push({
          pose: p.pose_keypoints_2d || null,
          hand_left: p.hand_left_keypoints_2d || p.hand_left_keypoints || null,
          hand_right: p.hand_right_keypoints_2d || p.hand_right_keypoints || null
        });
      } catch (err) {
        console.warn('Skipping invalid JSON file', f.name, err);
      }
    }
    frames = newFrames;
    frameIndex = 0;
    END_FRAME = Math.max(0, frames.length - 1);
    console.log(`Adjusted END_FRAME to ${END_FRAME}`);
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

function getScaleFactor(k) {
  if (!dynamicThickness) return 1.0;
  
  const neckIdx = 1 * 3;
  const midHipIdx = 8 * 3;
  
  if (k[neckIdx+2] >= CONF_THRESH && k[midHipIdx+2] >= CONF_THRESH) {
    const dx = k[midHipIdx] - k[neckIdx];
    const dy = k[midHipIdx+1] - k[neckIdx+1];
    const torsoLength = Math.sqrt(dx*dx + dy*dy);
    
    const referenceTorsoLength = 200;
    const scale = torsoLength / referenceTorsoLength;
    
    return Math.max(0.3, Math.min(scale, 2.0));
  }
  
  return 1.0;
}

function drawPose(k) {
  if (!k) return;
  
  const scaleFactor = getScaleFactor(k);
  const currentThickness = lineThickness * scaleFactor;
  
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
  
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = currentThickness;
  ctx.lineCap = "round";
  for (const [a,b] of BONES) {
    if ((a === 1 && b === 0) || (a === 0 && b === 1)) continue;
    
    const ia = a * 3, ib = b * 3;
    if (k[ia+2] < CONF_THRESH || k[ib+2] < CONF_THRESH) continue;
    ctx.beginPath();
    ctx.moveTo(k[ia], k[ia+1]);
    ctx.lineTo(k[ib], k[ib+1]);
    ctx.stroke();
  }
  
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

function drawHand(h, scaleFactor = 1.0) {
  if (!h) return;
  if (!Array.isArray(h) || h.length < 63) {
    console.warn('Invalid hand data:', h);
    return;
  }
  
  const handThickness = Math.max(2, lineThickness * 0.6 * scaleFactor);
  const jointSize = Math.max(2, 3 * scaleFactor);
  
  ctx.strokeStyle = '#25ee39';
  ctx.lineWidth = handThickness;
  ctx.lineCap = 'round';
  for (const [a,b] of HAND_BONES) {
    const ia = a*3, ib = b*3;
    if ((h[ia+2] || 0) < HAND_CONF_THRESH || (h[ib+2] || 0) < HAND_CONF_THRESH) continue;
    ctx.beginPath();
    ctx.moveTo(h[ia], h[ia+1]);
    ctx.lineTo(h[ib], h[ib+1]);
    ctx.stroke();
  }
  
  if (showJoints) {
    for (let i = 0; i < h.length; i += 3) {
      if ((h[i+2] || 0) < HAND_CONF_THRESH) continue;
      ctx.beginPath();
      ctx.arc(h[i], h[i+1], jointSize, 0, Math.PI*2);
      ctx.fillStyle = '#3eff28';
      ctx.fill();
    }
  }
}

function drawFrame(frame) {
  if (!frame) return;
  const pose = frame.pose || frame; 
  drawPose(pose);
  if (frame.hand_left) drawHand(frame.hand_left);
  if (frame.hand_right) drawHand(frame.hand_right);
}

let lastTime = 0;
function loop(time) {
  if (time - lastTime > 1000 / fps) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFrame(frames[frameIndex]);
    frameIndex = (frameIndex + 1) % frames.length;
    lastTime = time;
  }
  requestAnimationFrame(loop);
}

async function exportVideoMP4() {
  try {
    const stream = canvas.captureStream(fps);
    const mediaRecorder = new MediaRecorder(stream, { 
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 2500000
    });
    
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    
    mediaRecorder.start();
    statusEl.textContent = "Recording frames...";
    
    let frameCount = 0;
    const frameDuration = 1000 / fps;
    const totalFrames = frames.length;
    const startTime = performance.now();
    
    await new Promise((resolve) => {
      const recordingLoop = () => {
        const elapsed = performance.now() - startTime;
        const expectedFrameIndex = Math.floor(elapsed / frameDuration) % totalFrames;
        
        if (expectedFrameIndex !== frameCount) {
          frameCount = expectedFrameIndex;
          statusEl.textContent = `Recording: ${frameCount + 1}/${totalFrames}`;
          
          if (frameCount >= totalFrames - 1) {
            mediaRecorder.stop();
            resolve();
            return;
          }
        }
        
        requestAnimationFrame(recordingLoop);
      };
      recordingLoop();
    });
    
    await new Promise((resolve) => {
      mediaRecorder.onstop = () => resolve();
    });
    
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skeleton_animation_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    statusEl.textContent = "Video exported successfully!";
    setTimeout(() => {
      statusEl.textContent = "Select a folder to load frames";
      loadAndExportBtn.disabled = false;
    }, 2000);
  } catch (err) {
    console.error('Export error:', err);
    statusEl.textContent = `Error: ${err.message}`;
    loadAndExportBtn.disabled = false;
  }
}

console.log("Ready to load frames via folder picker");
