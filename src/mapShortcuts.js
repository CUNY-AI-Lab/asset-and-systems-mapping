// A text field, native select or dialog always owns its keystrokes.
export function mapShortcut(event) {
  const target=event.target;
  if(event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing || event.keyCode===229 || event.altKey ||
    target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],dialog'))return null;
  const key=event.key.toLowerCase(), mod=event.ctrlKey || event.metaKey;
  if(mod) {
    if(key==='z')return event.shiftKey?'redo':'undo';
    if(key==='y'&&event.ctrlKey&&!event.metaKey&&!event.shiftKey)return 'redo';
    if(key==='f'&&!event.shiftKey)return 'find';
    return null;
  }
  if(!event.shiftKey && ['delete','backspace'].includes(key))return 'remove';
  if(!target?.closest?.('.graph-canvas'))return null;
  return {'0':'fit','/':'find','?':'keys'}[key] || null;
}
