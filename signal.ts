// deno-lint-ignore-file no-explicit-any

export interface Ref<T = any> {
  value: T;
}
export interface Computed<T = any> {
  readonly value: T;
}

export type State = RefState | ComputedState | EffectState;

class Capture {
  _getters: Set<RefState | ComputedState>;
  _setters: Set<RefState>;

  constructor() {
    this._getters = new Set();
    this._setters = new Set();
  }
}

let currentCapture: Capture | null = null;

let dirtyStates = new Set<RefState>();
let currentUpdate = false;

function enqueueUpdate(node: RefState) {
  dirtyStates.add(node);
  if (!currentUpdate) {
    currentUpdate = true;
    setTimeout(updateStates);
  }
}

function updateStates() {
  currentUpdate = false;

  console.log(dirtyStates);

  while (dirtyStates.size > 0) {
    const dirty = [...dirtyStates];
    dirtyStates = new Set();
    const queue: (ComputedState | EffectState)[] = [];

    for (const refState of dirty) {
      if (refState._update()) {
        for (const dest of refState._listeners) {
          queue.push(dest);
        }
      }
    }

    while (queue.length > 0) {
      const node = queue.pop()!;

      if (node._update()) {
        if (node instanceof ComputedState) {
          for (const dest of node._listeners) {
            queue.push(dest);
          }
        }
      }
    }
  }
}

let recursive: false | "computed" | "effect" = false;

function assertRecursive(name: string) {
  if (recursive) {
    if (name === "effect" && recursive === "effect") return;
    throw new TypeError(`Cannot construct ${name} inside ${recursive}`);
  }
}

let refId: number = 0;
export class RefState<T = any> implements Ref<T> {
  private _old: T;
  private _state: T;
  private _pending: T;
  _id: number;
  _listeners: Set<ComputedState | EffectState> = new Set();

  constructor(init: T) {
    assertRecursive("ref");
    this._id = refId++;

    this._old = init;
    this._state = init;
    this._pending = init;
  }

  get value(): T {
    currentCapture?._getters.add(this);
    return this._state;
  }

  set value(state: T) {
    currentCapture?._setters.add(this);
    if (state !== this._state) {
      this._pending = state;
      enqueueUpdate(this);
    }
  }

  _update(): boolean {
    if (this._state === this._pending) {
      return false;
    }
    this._old = this._state;
    this._state = this._pending;
    return true;
  }
}

let computedId: number = 0;
export class ComputedState<T = any> implements Computed<T> {
  private _fn: () => T;
  private _old: T;
  private _state: T;
  private _capture: Capture;
  _id: number;
  _listeners: Set<ComputedState | EffectState> = new Set();

  constructor(fn: () => T) {
    assertRecursive("computed");
    this._id = computedId++;

    this._fn = fn;
    this._capture = new Capture();

    recursive = "computed";
    const state = runCapture(fn, this._capture);
    recursive = false;

    for (const node of this._capture._getters) {
      node._listeners.add(this);
    }
    this._old = state;
    this._state = state;
  }

  get value(): T {
    currentCapture?._getters.add(this);
    return this._state;
  }

  _update(): boolean {
    // remove old links
    for (const node of this._capture._getters) {
      node._listeners.delete(this);
    }

    // capture new deps
    this._capture = new Capture();
    const state = runCapture(this._fn, this._capture);

    // link to current getters
    for (const node of this._capture._getters) {
      node._listeners.add(this);
    }

    // skip graph update if nothing changes
    if (state === this._state) {
      return false;
    }

    // update current states
    this._old = this._state;
    this._state = state;

    return true;
  }

  _remove() {
    for (const node of this._capture._getters) {
      node._listeners.delete(this);
    }
  }
}

let effectId: number = 0;
export class EffectState {
  private _fn: () => void | (() => void);
  private _capture: Capture;
  private _clear: void | (() => void);
  _id: number;
  _deleted: boolean;

  constructor(fn: () => void | (() => void)) {
    assertRecursive("effect");
    this._id = effectId++;

    this._fn = fn;
    this._capture = new Capture();

    recursive = "effect";
    this._clear = runCapture(fn, this._capture);
    recursive = false;

    for (const node of this._capture._getters) {
      node._listeners.add(this);
    }
    this._deleted = false;
  }

  _update(): void {
    if (this._deleted) {
      return;
    }
    if (typeof this._clear === "function") {
      this._clear();
    }
    for (const node of this._capture._getters) {
      node._listeners.delete(this);
    }

    this._capture = new Capture();
    this._clear = runCapture(this._fn, this._capture);

    for (const node of this._capture._getters) {
      node._listeners.add(this);
    }
  }

  _remove() {
    if (typeof this._clear === "function") {
      this._clear();
    }
    for (const node of this._capture._getters) {
      node._listeners.delete(this);
    }
    this._deleted = true;
  }
}

function runCapture<T>(fn: () => T, capture: Capture) {
  const previousCapture = currentCapture;
  currentCapture = capture;
  try {
    return fn();
  } finally {
    currentCapture = previousCapture;
  }
}

let currentRefs: RefState[] | null = null;
let currentComputes: ComputedState[] | null = null;
let currentEffects: EffectState[] | null = null;

export function ref<T>(): Ref<T | null>;
export function ref<T>(init: T): Ref<T>;
export function ref<T>(init: T = null as T): Ref<T> {
  const state = new RefState(init);
  currentRefs?.push(state);
  return state;
}

export function computed<T>(fn: () => T): Computed<T> {
  const state = new ComputedState(fn);
  currentComputes?.push(state);
  return state;
}

export function effect(fn: () => void | (() => void)): void {
  const state = new EffectState(fn);
  currentEffects?.push(state);
}

export function collect<T>(
  fn: () => T
): [T, RefState[], ComputedState[], EffectState[]] {
  currentRefs = [];
  currentComputes = [];
  currentEffects = [];
  try {
    const ret = fn();
    return [ret, currentRefs, currentComputes, currentEffects];
  } finally {
    currentRefs = null;
    currentComputes = null;
    currentEffects = null;
  }
}

export function isComputed<T>(v: unknown): v is Computed<T> {
  return v instanceof ComputedState || v instanceof RefState;
}

export function isRef<T>(v: unknown): v is Ref<T> {
  return v instanceof RefState;
}
