import * as THREE from 'three';

export class CloudSystem {
  group: THREE.Group = new THREE.Group();

  constructor(scene: THREE.Scene, count: number = 35) {
    const cloudGeo = new THREE.BoxGeometry(1, 1, 1);
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85
    });

    for (let i = 0; i < count; i++) {
      const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
      const cx = (Math.random() - 0.5) * 1200;
      const cz = (Math.random() - 0.5) * 1200;
      const cy = 160 + Math.random() * 40;
      const scaleX = 40 + Math.random() * 80;
      const scaleZ = 30 + Math.random() * 60;
      const scaleY = 8 + Math.random() * 12;

      cloudMesh.position.set(cx, cy, cz);
      cloudMesh.scale.set(scaleX, scaleY, scaleZ);
      this.group.add(cloudMesh);
    }

    scene.add(this.group);
  }

  update(delta: number): void {
    this.group.position.x += delta * 4;
    if (this.group.position.x > 600) {
      this.group.position.x = -600;
    }
  }
}
