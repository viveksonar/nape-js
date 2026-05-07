import * as THREE from "three";

/**
 * Three.js renderer.
 *
 * Coordinate convention: nape uses Y=down (canvas-style). Three.js uses
 * Y=up. We keep nape's coordinates throughout the game logic and only
 * convert at the rendering edge:
 *   - polygon geometry verts are flipped (1, -1, 1) at construction
 *   - mesh.position.y = -body.position.y
 *   - mesh.rotation.z = -body.rotation
 *
 * To swap to this renderer, change main.js to import this file and add
 * `three` to your package.json deps.
 */

const COLORS = {
  bg: 0x0a0e14,
  tile: 0x3a4252,
  player: 0x58a6ff,
  playerInvuln: 0x9cd1ff,
  coin: 0xf4c14b,
  hazard: 0xe34c5b,
  goalPole: 0xa371f7,
  goalFlag: 0xf0ce47,
  goomba: 0xad4e2a,
  spiky: 0x7b3ab8,
  destructible: 0x8c5e3c,
  fragment: 0xa07350,
  movingPlatform: 0x46a86b,
  bullet: 0xfff8c0,
};

const DEPTH = 32;

export class ThreeJsRenderer {
  constructor() {
    this.W = 960;
    this.H = 540;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this._tileGroup = null;
    this._bodyMeshes = new Map(); // Body → Mesh
  }

  mount(parent) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.bg);

    const camera = new THREE.OrthographicCamera(
      -this.W / 2,
      this.W / 2,
      this.H / 2,
      -this.H / 2,
      -1000,
      1000,
    );
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(this.W, this.H);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    parent.appendChild(renderer.domElement);

    // Lighting — ambient fill plus a directional key light from the upper-right.
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(1, 1, 1).normalize();
    scene.add(key);

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
  }

  get viewportW() {
    return this.W;
  }
  get viewportH() {
    return this.H;
  }

  render(game) {
    // Camera follow — camera is at world-space center of the viewport
    const cx = game.camera.renderX() + this.W / 2;
    const cy = game.camera.renderY() + this.H / 2;
    this.camera.position.x = cx;
    this.camera.position.y = -cy;

    this._ensureTiles(game);
    this._syncBody(game.player.body, COLORS.player, "extrude");
    this._syncBody(game.goal.body, COLORS.goalFlag, "extrude");
    for (const c of game.coins) {
      const mesh = this._syncBody(c.body, COLORS.coin, "circle");
      if (mesh) mesh.visible = !c.collected;
    }
    for (const h of game.hazards) this._syncBody(h.body, COLORS.hazard, "extrude");
    for (const e of game.enemies) {
      const mesh = this._syncBody(
        e.body,
        e.kind === "goomba" ? COLORS.goomba : COLORS.spiky,
        "extrude",
      );
      if (mesh) mesh.visible = !e.dead;
    }
    for (const p of game.movingPlatforms) {
      this._syncBody(p.body, COLORS.movingPlatform, "extrude");
    }
    for (const d of game.destructibles) {
      if (!d.broken) {
        this._syncBody(d.body, COLORS.destructible, "extrude");
      }
      for (const frag of d._fragments) {
        this._syncBody(frag, COLORS.fragment, "extrude");
      }
    }
    for (const b of game.projectiles.active) {
      this._syncBody(b.body, COLORS.bullet, "circle");
    }

    // Hide meshes whose bodies have left the space (e.g. recycled bullets)
    for (const [body, mesh] of this._bodyMeshes) {
      if (!body.space) mesh.visible = false;
    }

    // Player invulnerability blink
    const playerMesh = this._bodyMeshes.get(game.player.body);
    if (playerMesh) {
      const blink = game.player.isInvulnerable() && Math.floor(performance.now() / 80) % 2 === 0;
      playerMesh.material.color.setHex(blink ? COLORS.playerInvuln : COLORS.player);
      playerMesh.visible = !game.player.isDead();
    }

    this.renderer.render(this.scene, this.camera);
  }

  _ensureTiles(game) {
    if (this._tileGroup) return;
    const group = new THREE.Group();
    const mat = new THREE.MeshPhongMaterial({ color: COLORS.tile, shininess: 50 });
    const body = game.levelBody;
    for (let i = 0; i < body.shapes.length; i++) {
      const verts = body.shapes.at(i).castPolygon?.worldVerts;
      if (!verts) continue;
      const pts = [];
      for (let j = 0; j < verts.length; j++) {
        const v = verts.at(j);
        pts.push(new THREE.Vector2(v.x, -v.y));
      }
      const geom = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
        depth: DEPTH,
        bevelEnabled: true,
        bevelSize: 1.5,
        bevelThickness: 1.5,
        bevelSegments: 1,
      });
      geom.translate(0, 0, -DEPTH / 2);
      group.add(new THREE.Mesh(geom, mat));
    }
    this.scene.add(group);
    this._tileGroup = group;
  }

  _syncBody(body, color, kind) {
    let mesh = this._bodyMeshes.get(body);
    if (!mesh) {
      mesh = this._createMeshFor(body, color, kind);
      if (!mesh) return null;
      this._bodyMeshes.set(body, mesh);
      this.scene.add(mesh);
    }
    mesh.visible = body.space != null;
    mesh.position.set(body.position.x, -body.position.y, 0);
    mesh.rotation.z = -body.rotation;
    return mesh;
  }

  _createMeshFor(body, color, kind) {
    const shape = body.shapes.at(0);
    if (!shape) return null;
    let geom;
    if (kind === "circle" && shape.castCircle) {
      geom = new THREE.SphereGeometry(shape.castCircle.radius, 16, 16);
    } else if (shape.castPolygon) {
      const verts = shape.castPolygon.localVerts;
      const pts = [];
      for (let j = 0; j < verts.length; j++) {
        const v = verts.at(j);
        pts.push(new THREE.Vector2(v.x, -v.y));
      }
      geom = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
        depth: DEPTH,
        bevelEnabled: true,
        bevelSize: 1.5,
        bevelThickness: 1.5,
        bevelSegments: 1,
      });
      geom.translate(0, 0, -DEPTH / 2);
    } else {
      return null;
    }
    const mat = new THREE.MeshPhongMaterial({ color, shininess: 70 });
    return new THREE.Mesh(geom, mat);
  }
}
