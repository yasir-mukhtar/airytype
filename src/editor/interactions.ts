import {
  EditorSelection,
  Facet,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { externalChange } from './limits';
import { SentenceLocator, type SourceRange } from './sentence';
import { defaultEditorPreferences, type EditorPreferences } from './types';

export const editorPreferences = Facet.define<
  EditorPreferences,
  EditorPreferences
>({
  combine: (values) => values[0] ?? defaultEditorPreferences,
});

export interface CompositionSession {
  active: boolean;
}
const setFocusRange = StateEffect.define<SourceRange | null>();
const muted = Decoration.mark({ class: 'airy-focus-muted' });

const focusDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setFocusRange)) continue;
      const range = effect.value;
      if (!range) value = Decoration.none;
      else {
        const marks = [];
        if (range.from > 0) marks.push(muted.range(0, range.from));
        if (range.to < transaction.newDoc.length)
          marks.push(muted.range(range.to, transaction.newDoc.length));
        value = Decoration.set(marks);
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function sameRange(a: SourceRange | null, b: SourceRange | null): boolean {
  return a === b || (!!a && !!b && a.from === b.from && a.to === b.to);
}

/** Geometry comes from CodeMirror's public wrapped-row API, never average glyph width. */
export function visibleRowRange(view: EditorView): SourceRange | null {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  // Logical marks cannot faithfully express a disjoint visual row in mixed bidi text.
  if (view.bidiSpans(line).length > 1) return null;
  const start = EditorSelection.cursor(selection.head, selection.assoc);
  const from = view.moveToLineBoundary(start, false, true).head;
  const to = view.moveToLineBoundary(start, true, true).head;
  return from <= to ? { from, to } : null;
}

export function writingInteractions(
  composition: CompositionSession,
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      private locator = new SentenceLocator();
      private version = 0;
      private activeRange: SourceRange | null = null;
      private needsFocusUpdate = true;
      private pendingAnchor = false;
      private retriedMissingCaret = false;
      private destroyed = false;
      private topPadding = 24;
      private bottomPadding = 160;
      private endCompositionFrame = 0;
      private layoutFrame = 0;
      private nativeInputPending = false;
      private nativeInputTimer = 0;
      private handleScrollIntent = () => this.cancelAnchor();

      constructor(readonly view: EditorView) {
        // Scrollbars are outside contentDOM, where CodeMirror installs plugin handlers.
        for (const event of ['wheel', 'pointerdown', 'touchstart']) {
          view.scrollDOM.addEventListener(event, this.handleScrollIntent, {
            capture: true,
            passive: true,
          });
        }
        this.schedule();
      }

      update(update: ViewUpdate) {
        const preferences = update.state.facet(editorPreferences);
        const previous = update.startState.facet(editorPreferences);
        const changedPreferences = preferences !== previous;
        if (changedPreferences && preferences.scroll !== previous.scroll) {
          this.pendingAnchor = preferences.scroll !== 'off';
          this.retriedMissingCaret = false;
        }
        if (update.docChanged) {
          // Mapping is immediate; geometry waits until CodeMirror completes layout.
          if (this.activeRange)
            this.activeRange = {
              from: update.changes.mapPos(this.activeRange.from, -1),
              to: update.changes.mapPos(this.activeRange.to, 1),
            };
          const localEdit = update.transactions.some(
            (transaction) =>
              transaction.docChanged &&
              !transaction.annotation(externalChange) &&
              (transaction.isUserEvent('input') ||
                transaction.isUserEvent('delete') ||
                transaction.isUserEvent('undo') ||
                transaction.isUserEvent('redo')),
          );
          if (
            localEdit &&
            preferences.scroll !== 'off' &&
            !composition.active &&
            !update.view.composing
          ) {
            this.pendingAnchor = true;
            this.retriedMissingCaret = false;
          }
          if (
            update.transactions.some((transaction) =>
              transaction.annotation(externalChange),
            )
          )
            this.cancelAnchor();
        }
        if (update.selectionSet && !update.docChanged) this.cancelAnchor();
        if (!update.state.selection.main.empty || !update.view.hasFocus)
          this.cancelAnchor();
        if (
          update.docChanged ||
          update.selectionSet ||
          update.focusChanged ||
          changedPreferences
        )
          this.schedule();
        else if (
          (update.geometryChanged || update.viewportChanged) &&
          !this.layoutFrame
        ) {
          // Geometry-only updates may themselves occur inside CodeMirror's measure
          // loop. Schedule their follow-up in the next frame, avoiding recursively
          // restarting that same loop during sidebar/font/viewport changes.
          this.layoutFrame = requestAnimationFrame(() => {
            this.layoutFrame = 0;
            if (!this.destroyed) this.schedule();
          });
        }
      }

      cancelAnchor() {
        this.pendingAnchor = false;
        this.version++;
      }

      beginNativeInput() {
        this.nativeInputPending = true;
        this.version++;
        window.clearTimeout(this.nativeInputTimer);
        // A prevented beforeinput need not be followed by input.
        this.finishNativeInput();
      }

      finishNativeInput() {
        window.clearTimeout(this.nativeInputTimer);
        // Let the native input's mutation/selection observers finish before a
        // cosmetic transaction can cause CodeMirror to synchronize the DOM.
        this.nativeInputTimer = window.setTimeout(() => {
          this.nativeInputPending = false;
          if (!this.destroyed) this.schedule();
        }, 0);
      }

      nativeSelectionMatchesState(): boolean {
        if (!this.view.hasFocus) return true;
        const selection = this.view.contentDOM.ownerDocument.getSelection();
        if (!selection?.anchorNode || !selection.focusNode) return false;
        try {
          const main = this.view.state.selection.main;
          return (
            this.view.posAtDOM(selection.anchorNode, selection.anchorOffset) ===
              main.anchor &&
            this.view.posAtDOM(selection.focusNode, selection.focusOffset) ===
              main.head
          );
        } catch {
          return false;
        }
      }

      beginComposition() {
        composition.active = true;
        cancelAnimationFrame(this.endCompositionFrame);
        cancelAnimationFrame(this.layoutFrame);
        this.layoutFrame = 0;
        this.cancelAnchor();
      }

      finishComposition() {
        // Native compositionend can precede CodeMirror's final input transaction.
        this.endCompositionFrame = requestAnimationFrame(() => {
          this.endCompositionFrame = requestAnimationFrame(() => {
            if (this.destroyed) return;
            composition.active = false;
            this.pendingAnchor =
              this.view.state.facet(editorPreferences).scroll !== 'off';
            this.retriedMissingCaret = false;
            this.schedule();
          });
        });
      }

      shouldOwnScroll(): boolean {
        if (
          !this.pendingAnchor ||
          composition.active ||
          this.view.composing ||
          !this.view.state.selection.main.empty
        )
          return false;
        // If virtualized, let CodeMirror reveal it once before our one remeasurement.
        return (
          this.view.coordsAtPos(this.view.state.selection.main.head) !== null
        );
      }

      schedule() {
        const version = ++this.version;
        this.view.requestMeasure({
          key: this,
          read: (view) => {
            const preferences = view.state.facet(editorPreferences);
            const selection = view.state.selection.main;
            const scroller = view.scrollDOM;
            const viewport = scroller.getBoundingClientRect();
            const height = scroller.clientHeight;
            const fraction = preferences.scroll === 'middle' ? 0.5 : 0.25;
            const halfLine = view.defaultLineHeight / 2;
            const topPadding =
              preferences.scroll === 'off'
                ? 24
                : Math.max(24, height * fraction - halfLine);
            const bottomPadding =
              preferences.scroll === 'off'
                ? 160
                : Math.max(24, height * (1 - fraction) - halfLine);
            const composing = composition.active || view.composing;
            const caret = view.coordsAtPos(
              selection.head,
              selection.assoc || 1,
            );
            let range: SourceRange | null = null;
            if (composing) range = this.activeRange;
            else if (
              preferences.focus !== 'off' &&
              view.hasFocus &&
              selection.empty &&
              view.state.selection.ranges.length === 1 &&
              caret &&
              caret.bottom >= viewport.top &&
              caret.top <= viewport.bottom
            ) {
              if (preferences.focus === 'sentence') {
                let node = syntaxTree(view.state).resolveInner(
                  selection.head,
                  selection.assoc || 1,
                );
                let code = false;
                for (;;) {
                  if (
                    /^(FencedCode|CodeBlock|InlineCode|Table|TableRow|URL)$/.test(
                      node.name,
                    )
                  )
                    code = true;
                  if (!node.parent) break;
                  node = node.parent;
                }
                const sentence = code
                  ? null
                  : this.locator.locate(
                      view.state.doc,
                      selection.head,
                      preferences.language,
                      selection.assoc || 1,
                    );
                range =
                  sentence?.kind === 'sentence'
                    ? sentence.range
                    : visibleRowRange(view);
              } else range = visibleRowRange(view);
            }
            const anchor =
              this.pendingAnchor &&
              !composing &&
              selection.empty &&
              view.hasFocus &&
              preferences.scroll !== 'off';
            return {
              version,
              range,
              topPadding,
              bottomPadding,
              anchor,
              delta:
                anchor && caret
                  ? (caret.top + caret.bottom) / 2 -
                    (viewport.top + scroller.clientTop + height * fraction)
                  : null,
            };
          },
          write: (measurement, view) => {
            if (this.destroyed || measurement.version !== this.version) return;
            const paddingChanged =
              Math.abs(this.topPadding - measurement.topPadding) > 0.5 ||
              Math.abs(this.bottomPadding - measurement.bottomPadding) > 0.5;
            if (paddingChanged) {
              const topChange = measurement.topPadding - this.topPadding;
              this.topPadding = measurement.topPadding;
              this.bottomPadding = measurement.bottomPadding;
              view.contentDOM.style.paddingTop = `${this.topPadding}px`;
              view.contentDOM.style.paddingBottom = `${this.bottomPadding}px`;
              if (!measurement.anchor && topChange)
                view.scrollDOM.scrollTop += topChange;
              this.schedule();
            } else if (measurement.anchor && measurement.delta !== null) {
              this.pendingAnchor = false;
              if (Math.abs(measurement.delta) > 2)
                view.scrollDOM.scrollTop += measurement.delta;
            } else if (measurement.anchor && !this.retriedMissingCaret) {
              this.retriedMissingCaret = true;
              this.schedule();
            }
            if (
              this.needsFocusUpdate ||
              !sameRange(this.activeRange, measurement.range)
            ) {
              // CodeMirror runs measure writes during its update. Dispatch after that
              // update finishes, and discard geometry made stale by a newer event.
              queueMicrotask(() => {
                if (this.destroyed || measurement.version !== this.version)
                  return;
                if (
                  this.nativeInputPending ||
                  composition.active ||
                  view.composing ||
                  !this.nativeSelectionMatchesState()
                )
                  return;
                this.activeRange = measurement.range;
                this.needsFocusUpdate = false;
                view.dispatch({ effects: setFocusRange.of(measurement.range) });
              });
            }
          },
        });
      }

      destroy() {
        this.destroyed = true;
        cancelAnimationFrame(this.endCompositionFrame);
        cancelAnimationFrame(this.layoutFrame);
        window.clearTimeout(this.nativeInputTimer);
        for (const event of ['wheel', 'pointerdown', 'touchstart']) {
          this.view.scrollDOM.removeEventListener(
            event,
            this.handleScrollIntent,
            true,
          );
        }
        composition.active = false;
      }
    },
    {
      eventHandlers: {
        beforeinput() {
          this.beginNativeInput();
        },
        input() {
          this.finishNativeInput();
        },
        wheel() {
          this.cancelAnchor();
        },
        touchstart() {
          this.cancelAnchor();
        },
        pointerdown() {
          this.cancelAnchor();
        },
        compositionstart() {
          this.beginComposition();
        },
        compositionend() {
          this.finishComposition();
        },
        blur() {
          this.cancelAnchor();
          this.schedule();
        },
      },
    },
  );

  return [
    focusDecorations,
    plugin,
    EditorView.scrollHandler.of(
      (view) => view.plugin(plugin)?.shouldOwnScroll() ?? false,
    ),
  ];
}
