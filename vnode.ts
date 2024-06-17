// deno-lint-ignore-file ban-types no-explicit-any
import { isRef, type Computed, type Ref } from "./signal.ts";

export type Key = string | number;

export class VNode {
  constructor(
    public type: string | ComponentType | null,
    public props: Props,
    public slots: Slots,
    public key?: Key,
    public ref?: Ref
  ) {}
}

export interface LyDOMAttributes {
  children?: ComponentChildren;
  _dangerouslySetInnerHTML?: { __html: string };
}

export interface ClassAttributes<T = any> {
  key?: Key;
  ref?: Ref<T>;
}

export type Primitive = string | number | bigint | boolean | null | undefined;
export type ComponentChild = Primitive | Computed<Primitive> | VNode;
export type ComponentChildren = ComponentChild | ComponentChild[];

export type Props = Record<string, any>;
export type Slots = Record<string, ComponentChild[]>;
export type ComponentType<P = {}> = (
  props: P
) => ComponentChildren | (() => ComponentChildren);

export function component$<P = {}>(
  component: ComponentType<P>
): ComponentType<P> {
  return component;
}

export const Fragment = component$(() => createElement(Slot, null));
export const Slot = component$<{ name?: string }>(() => {
  throw new Error("Usage of <Slot /> outside of components");
});

let currentSlots: Slots | null = null;
const DEFAULT_SLOT_NAME = "default";

export function provideSlots<T>(slots: Slots, callback: () => T) {
  const old = currentSlots;
  currentSlots = slots;
  try {
    return callback();
  } finally {
    currentSlots = old;
  }
}

export function createElement(
  type: string | ComponentType | null,
  props: Props | null,
  ...children: ComponentChild[]
): VNode {
  props ??= {};

  if (type === Slot) {
    const name = props["name"] || DEFAULT_SLOT_NAME;
    return createElement(null, null, ...(currentSlots?.[name] ?? children));
  }

  const slots: Slots = {};
  const normalizedProps: Props = {};

  let ref: Ref | undefined = undefined;

  for (const child of children) {
    if (isVNode(child) && child.type === "template") {
      const name = child.props["slot"] || DEFAULT_SLOT_NAME;
      slots[name] ??= [];
      slots[name].push(...(child.slots[DEFAULT_SLOT_NAME] ?? []));
    } else {
      slots[DEFAULT_SLOT_NAME] ??= [];
      slots[DEFAULT_SLOT_NAME].push(child);
    }
  }

  for (const key in props) {
    const value = props[key];

    if (key === "ref") {
      if (isRef(value)) {
        ref = value;
      }
    } else {
      normalizedProps[key] = value;
    }
  }

  return new VNode(type, normalizedProps, slots, undefined, ref);
}

export function isVNode(vnode: unknown): vnode is VNode {
  return vnode instanceof VNode;
}
