/**
 * Re-exports @blinkdotnew/ui Dialog components with corrected TypeScript types.
 *
 * The upstream type definitions carry over legacy Radix v1 props
 * (placeholder, onPointerEnterCapture, onPointerLeaveCapture) that are no
 * longer needed but cause TS errors at every call site. This wrapper
 * strips those phantom props so consuming files stay clean.
 */
import {
  Dialog,
  DialogContent as _DialogContent,
  DialogHeader,
  DialogTitle as _DialogTitle,
} from '@blinkdotnew/ui'
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  ForwardRefExoticComponent,
  RefAttributes,
} from 'react'

type CleanProps<T> = Omit<T, 'placeholder' | 'onPointerEnterCapture' | 'onPointerLeaveCapture'>

export const DialogContent = _DialogContent as unknown as ForwardRefExoticComponent<
  CleanProps<ComponentPropsWithoutRef<typeof _DialogContent>> & RefAttributes<ElementRef<typeof _DialogContent>>
>

export const DialogTitle = _DialogTitle as unknown as ForwardRefExoticComponent<
  CleanProps<ComponentPropsWithoutRef<typeof _DialogTitle>> & RefAttributes<ElementRef<typeof _DialogTitle>>
>

export { Dialog, DialogHeader }
