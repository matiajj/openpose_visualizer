const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const CONF_THRESH = 0.1;// confidence threshold for pose keypoints
const HAND_CONF_THRESH = 0.1;// confidence threshold for hand keypoints
const START_FRAME = 0;// starting frame index
let END_FRAME = 0;// ending frame index (adjusted based on loaded frames)


const BONES = [
  [1,0],
  [1,2],[2,3],[3,4],// right arm
  [1,5],[5,6],[6,7],// left arm
  [1,8],
  [8,9],[9,10],[10,11],// right leg
  [8,12],[12,13],[13,14]// left leg
];

const HAND_BONES = [
  [0,1],[1,2],[2,3],[3,4],// thumb
  [0,5],[5,6],[6,7],[7,8],// index finger
  [0,9],[9,10],[10,11],[11,12],// middle finger
  [0,13],[13,14],[14,15],[15,16],// ring finger
  [0,17],[17,18],[18,19],[19,20]// pinky finger
];

let lineThickness = 8;
let fps = 30;
let showJoints = true;
let lineColor = "#ffffff";
let dynamicThickness = false;// all the above are determined in the UI controls
let started = false;// loop started flag
let headRadius = null; // const to fall back on when ears not visible

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


// update line thickness from slider in UI controls
lineThicknessSlider.addEventListener("input", (e) => {
  lineThickness = parseInt(e.target.value);
  lineThicknessValue.value = lineThickness;
});

// update line thickness from text input in UI controls
lineThicknessValue.addEventListener("input", (e) => {
  lineThickness = parseInt(e.target.value);
  lineThicknessSlider.value = lineThickness;
});

// update fpa from slider in UI controls
fpsSlider.addEventListener("input", (e) => {
  fps = parseInt(e.target.value);
  fpsValue.value = fps;
});

// update fps from text input in UI controls
fpsValue.addEventListener("input", (e) => {
  fps = parseInt(e.target.value);
  fpsSlider.value = fps;
});

// update joint visibility checkox in UI controls
showJointsCheckbox.addEventListener("change", (e) => {
  showJoints = e.target.checked;
});

// update line color from UI controls
lineColorPicker.addEventListener("input", (e) => {
  lineColor = e.target.value;
});

// checkbox dynamic thickness from UI controls
dynamicThicknessCheckbox.addEventListener("change", (e) => {
  dynamicThickness = e.target.checked;
});

loadAndExportBtn.addEventListener("click", async () => {
  // filter for JSON files only
  let files = Array.from(jsonFilesInput.files || []);
  files = files.filter(f => f.name.toLowerCase().endsWith('.json'));
  if (!files.length) {
    statusEl.textContent = "No JSON files selected in folder";
    return;
  }
  
  loadAndExportBtn.disabled = true;
  statusEl.textContent = "Loading JSON files from folder...";
  
  // load JSON files into memory
  const loaded = await loadJsonFiles(files);
  if (loaded) {
    statusEl.textContent = `Loaded ${frames.length} frames. Starting export...`;
    startLoopIfNeeded();
    
    // delay for starting rendering
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // same time start export to video
    await exportVideoMP4();
  } else {
    statusEl.textContent = "Failed to load JSON files";
    loadAndExportBtn.disabled = false;
  }
});


let frames = [];// keypoint frames loaded from JSON files
let frameIndex = 0;// index for current frame used in animation


// loads keypoints into frames array
async function loadJsonFiles(fileList) {
  try {
    // filter and sort JSONs in numerical order
    fileList = fileList.filter(f => f.name.toLowerCase().endsWith('.json'));
    const getKey = (f) => (f.webkitRelativePath || f.name || "");
    fileList.sort((a,b) => getKey(a).localeCompare(getKey(b), undefined, {numeric:true}));
    const newFrames = [];
    for (const f of fileList) {
      try {
        // extract keypoint data from JSON
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
    headRadius = null; // Reset head radius for new animation
    END_FRAME = Math.max(0, frames.length - 1);
    console.log(`Adjusted END_FRAME to ${END_FRAME}`);
    return true;
  } catch (e) {
    console.error('loadJsonFiles error', e);
    return false;
  }
}



// starts the loop if not already running
function startLoopIfNeeded() {
  if (!started && frames.length > 0) {
    started = true;
    requestAnimationFrame(loop);
  }
}


// calculates scale factor based on body size (torso length) for dynamic line thickness
function getScaleFactor(k) {
  if (!dynamicThickness) return 1.0;
  
  const neckIdx = 3;// neck keypoint index
  const midHipIdx = 24;// mid hip keypoint index
  
  // calculate torso length if both neck and hip are visible
  if (k[neckIdx+2] >= CONF_THRESH && k[midHipIdx+2] >= CONF_THRESH) {
    const dx = k[midHipIdx] - k[neckIdx];
    const dy = k[midHipIdx+1] - k[neckIdx+1];
    const torsoLength = Math.sqrt(dx*dx + dy*dy);
    
    const referenceTorsoLength = 200;
    const scale = torsoLength / referenceTorsoLength;
    
    // keep scale factor between 0.3 and 2.0
    return Math.max(0.3, Math.min(scale, 2.0));
  }
  
  return 1.0;
}


// draws skeleton
function drawPose(k) {
  if (!k) return;
  
  // calculate line thickness
  const scaleFactor = getScaleFactor(k);
  const currentThickness = lineThickness * scaleFactor;
  
  
  const neckIdx = 3;//1*3
  const leftEarIdx = 51;//17*3
  const rightEarIdx = 54;//18*3
  
  // calculate and store head radius only when both ears are visible
  if (k[leftEarIdx+2] >= CONF_THRESH && k[rightEarIdx+2] >= CONF_THRESH) {
    const dx = k[rightEarIdx] - k[leftEarIdx];
    const dy = k[rightEarIdx+1] - k[leftEarIdx+1];
    const diameter = Math.sqrt(dx*dx + dy*dy);
    headRadius = diameter / 2 + currentThickness * 0.5;
  }
  
  // If radius still not set after first frame, use default
  if (headRadius === null && frameIndex > 0) {
    headRadius = 60 + currentThickness * 0.5;
  }

  console.log('Head radius:', headRadius);
  
  // Draw head using headRadius
  if (headRadius !== null) {
    const leftEarVisible = k[leftEarIdx+2] >= CONF_THRESH;
    const rightEarVisible = k[rightEarIdx+2] >= CONF_THRESH;
    
    let centerX, centerY;
    if (leftEarVisible && rightEarVisible) {
      // Both ears visible - use midpoint
      centerX = (k[leftEarIdx] + k[rightEarIdx]) / 2;
      centerY = (k[leftEarIdx+1] + k[rightEarIdx+1]) / 2;
    } else if (leftEarVisible) {
      // Only left ear visible
      centerX = k[leftEarIdx];
      centerY = k[leftEarIdx+1];
    } else if (rightEarVisible) {
      // Only right ear visible
      centerX = k[rightEarIdx];
      centerY = k[rightEarIdx+1];
    } else if (k[neckIdx+2] >= CONF_THRESH) {
      // No ears visible, use neck position
      centerX = k[neckIdx];
      centerY = k[neckIdx+1] - headRadius * 0.8;
    }
    
    // draw head circle
    if (centerX !== undefined) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, headRadius, 0, Math.PI*2);
      ctx.fillStyle = lineColor;
      ctx.fill();
    }
  }
  
  // draw connecting joints
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = currentThickness;
  ctx.lineCap = "round";
  for (const [a,b] of BONES) {
    // dont draw neck line
    if ((a === 1 && b === 0) || (a === 0 && b === 1)) continue;
    
    const ia = a * 3, ib = b * 3;
    // keypoint confidence check
    if (k[ia+2] < CONF_THRESH || k[ib+2] < CONF_THRESH) continue;
    ctx.beginPath();
    ctx.moveTo(k[ia], k[ia+1]);
    ctx.lineTo(k[ib], k[ib+1]);
    ctx.stroke();
  }
  
  // draw joint markers if enabled
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


// draws hands, fingers and joints
function drawHand(h, scaleFactor = 1.0) {
  if (!h) return;
  if (!Array.isArray(h) || h.length < 63) {
    console.warn('Invalid hand data:', h);
    return;
  }
  
  const handThickness = Math.max(2, lineThickness * 0.6 * scaleFactor);
  const jointSize = Math.max(2, 3 * scaleFactor);
  
  // neon green for hands to be more visible
  ctx.strokeStyle = '#25ee39';
  ctx.lineWidth = handThickness;
  ctx.lineCap = 'round';
  for (const [a,b] of HAND_BONES) {
    const ia = a*3, ib = b*3;
    // keypoint confidence check
    if ((h[ia+2] || 0) < HAND_CONF_THRESH || (h[ib+2] || 0) < HAND_CONF_THRESH) continue;
    ctx.beginPath();
    ctx.moveTo(h[ia], h[ia+1]);
    ctx.lineTo(h[ib], h[ib+1]);
    ctx.stroke();
  }
  
  // draw hand joint markers if enabled
  if (showJoints) {
    for (let i = 0; i < h.length; i += 3) {
      if ((h[i+2] || 0) < HAND_CONF_THRESH) continue;
      ctx.beginPath();
      ctx.arc(h[i], h[i+1], jointSize, 0, Math.PI*2);
      ctx.fillStyle = '#0afd47';
      ctx.fill();
    }
  }
}

// draws complete body and both hands
function drawFrame(frame) {
  if (!frame) return;
  const pose = frame.pose || frame; 
  drawPose(pose);
  if (frame.hand_left) drawHand(frame.hand_left);
  if (frame.hand_right) drawHand(frame.hand_right);
}

// animation loop
let lastTime = 0;
function loop(time) {
  // check fps rate
  if (time - lastTime > 1000 / fps) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFrame(frames[frameIndex]);
    frameIndex = (frameIndex + 1) % frames.length;
    lastTime = time;
  }
  requestAnimationFrame(loop);
}


// records canvas animation and exports as WebM video file
async function exportVideoMP4() {
  try {
    // capture canvas stream at specified FPS
    const stream = canvas.captureStream(fps);
    const mediaRecorder = new MediaRecorder(stream, { 
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 2500000
    });
    
    // store recorded chunks
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    
    // start recording
    mediaRecorder.start();
    statusEl.textContent = "Recording frames...";
    
    let frameCount = 0;
    const frameDuration = 1000 / fps;
    const totalFrames = frames.length;
    const startTime = performance.now();
    
    // recording with progress update
    await new Promise((resolve) => {
      const recordingLoop = () => {
        const elapsed = performance.now() - startTime;
        const expectedFrameIndex = Math.floor(elapsed / frameDuration) % totalFrames;
        
        if (expectedFrameIndex !== frameCount) {
          frameCount = expectedFrameIndex;
          statusEl.textContent = `Recording: ${frameCount + 1}/${totalFrames}`;
          
          // stop when all frames recorded
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
    
    // wait for recording to finish
    await new Promise((resolve) => {
      mediaRecorder.onstop = () => resolve();
    });
    
    // trigger download
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skeleton_animation_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // success message
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

// log to see wverything works properly
console.log("Ready to load frames via folder picker");
