import * as THREE from 'three';

export class FlightControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.isLocked = false;

    // Movement speeds in m/s
    this.cruiseSpeed = 35.0;
    this.boostMultiplier = 4.0;
    this.currentSpeed = this.cruiseSpeed;

    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    // Camera angles
    this.yaw = 0;
    this.pitch = -0.15; // slightly looking down at city

    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      boost: false
    };

    this.hasStarted = false;
    this.initListeners();
  }

  initListeners() {
    this.domElement.addEventListener('click', () => {
      // Don't capture if user was clicking an input or button
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'BUTTON')) {
        return;
      }
      if (!this.isLocked) {
        this.domElement.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = (document.pointerLockElement === this.domElement);
      const blocker = document.getElementById('instructions-overlay');
      if (blocker && this.isLocked) {
        this.hasStarted = true;
        blocker.style.display = 'none';
      }

      // Update cursor indicator badge in HUD
      const cursorBadge = document.getElementById('cursor-mode-badge');
      if (cursorBadge) {
        if (this.isLocked) {
          cursorBadge.textContent = 'РЕЖИМ: ПОЛЕТ (ESC - КУРСОР)';
          cursorBadge.className = 'cursor-badge flight-active';
        } else {
          cursorBadge.textContent = 'РЕЖИМ: КУРСОР (ЛКМ - ПОЛЕТ)';
          cursorBadge.className = 'cursor-badge cursor-active';
        }
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;

      const sensitivity = 0.0022;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;

      // Clamp pitch to avoid gimbal flipping
      const maxPitch = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
    });

    window.addEventListener('keydown', (e) => {
      // If user is typing in search input, completely ignore flight keys!
      const isInputActive = document.activeElement &&
        (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

      // Quick hotkey to open city search: "/" or "Enter" when not already typing
      if (!isInputActive && (e.code === 'Slash' || e.code === 'Enter')) {
        e.preventDefault();
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
          if (document.pointerLockElement) {
            document.exitPointerLock();
          }
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      if (isInputActive) {
        // ESC inside search input blurs it
        if (e.code === 'Escape') {
          document.activeElement.blur();
        }
        return;
      }

      // Protect against accidental Ctrl+W browser tab closure
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyW') {
        e.preventDefault();
        e.stopPropagation();
      }

      switch (e.code) {
        case 'KeyW': case 'ArrowUp': this.keys.forward = true; break;
        case 'KeyS': case 'ArrowDown': this.keys.backward = true; break;
        case 'KeyA': case 'ArrowLeft': this.keys.left = true; break;
        case 'KeyD': case 'ArrowRight': this.keys.right = true; break;
        case 'Space': this.keys.up = true; break;
        case 'KeyC': this.keys.down = true; break;
        case 'ShiftLeft': case 'ShiftRight': case 'KeyE': this.keys.boost = true; break;
      }
    });

    window.addEventListener('keyup', (e) => {
      const isInputActive = document.activeElement &&
        (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
      if (isInputActive) return;

      switch (e.code) {
        case 'KeyW': case 'ArrowUp': this.keys.forward = false; break;
        case 'KeyS': case 'ArrowDown': this.keys.backward = false; break;
        case 'KeyA': case 'ArrowLeft': this.keys.left = false; break;
        case 'KeyD': case 'ArrowRight': this.keys.right = false; break;
        case 'Space': this.keys.up = false; break;
        case 'KeyC': this.keys.down = false; break;
        case 'ShiftLeft': case 'ShiftRight': case 'KeyE': this.keys.boost = false; break;
      }
    });

    // Wheel to adjust cruise speed
    window.addEventListener('wheel', (e) => {
      if (!this.isLocked) return;
      if (e.deltaY < 0) {
        this.cruiseSpeed = Math.min(250, this.cruiseSpeed + 10);
      } else {
        this.cruiseSpeed = Math.max(10, this.cruiseSpeed - 10);
      }
    });
  }

  update(delta) {
    // 1. Update Camera Rotation using Euler angles (YXZ order)
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.x = this.pitch;
    euler.y = this.yaw;
    this.camera.quaternion.setFromEuler(euler);

    // 2. Compute Movement Vectors
    const speed = this.keys.boost
      ? this.cruiseSpeed * this.boostMultiplier
      : this.cruiseSpeed;

    const moveVector = new THREE.Vector3();

    // Forward/backward in camera look direction
    if (this.keys.forward) moveVector.z -= 1;
    if (this.keys.backward) moveVector.z += 1;
    // Left/Right strafe
    if (this.keys.left) moveVector.x -= 1;
    if (this.keys.right) moveVector.x += 1;

    moveVector.normalize();
    moveVector.applyEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));

    // Vertical fly up/down
    let verticalMove = 0;
    if (this.keys.up) verticalMove += 1;
    if (this.keys.down) verticalMove -= 1;

    // Smooth inertia
    const damping = Math.min(delta * 10, 1.0);
    this.velocity.x += (moveVector.x * speed - this.velocity.x) * damping;
    this.velocity.z += (moveVector.z * speed - this.velocity.z) * damping;
    this.velocity.y += (verticalMove * speed - this.velocity.y) * damping;

    // Apply to camera position
    this.camera.position.x += this.velocity.x * delta;
    this.camera.position.y += this.velocity.y * delta;
    this.camera.position.z += this.velocity.z * delta;

    // Clamp camera min height above void
    if (this.camera.position.y < 10) this.camera.position.y = 10;
  }

  getSpeedKmh() {
    return Math.round(this.velocity.length() * 3.6);
  }

  getLookDirection() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return dir;
  }

  setLookAngles(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  resetVelocity() {
    this.velocity.set(0, 0, 0);
  }
}
