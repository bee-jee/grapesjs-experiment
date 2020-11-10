const cursorBuilder = () => {
    const name = 'Test User';
    const color = '#ffa500';

    const userDiv = document.createElement('div');
    userDiv.style.display = 'none';
    userDiv.style.padding = '3px';
    userDiv.style.whiteSpace = 'nowrap';
    userDiv.style.position = 'absolute';
    userDiv.style.left = 'calc(100% + 3px)';
    userDiv.style.top = '-3px';
    userDiv.style.backgroundColor = color;
    userDiv.insertBefore(document.createTextNode(name), null);
    const cursor = document.createElement('div');
    cursor.style.border = `3px solid ${color}`;
    cursor.style.position = 'absolute';
    cursor.classList.add('user-cursor');
    cursor.insertBefore(userDiv, null);
    let timeout = null;
    cursor.onmouseover = () => {
        cursor.classList.add('hover');
        userDiv.style.display = 'block';
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
    };
    cursor.onmouseout = () => {
        timeout = setTimeout(() => {
            cursor.classList.remove('hover');
            userDiv.style.display = 'none';
        }, 1500);
    };
    return cursor;
};

const getBoundToRoot = (el, root) => {
    let left = el.offsetLeft;
    let top = el.offsetTop;
    let parent = el.offsetParent;
    while (parent !== root && parent !== null) {
      left += parent.offsetLeft;
      top += parent.offsetTop;
      parent = parent.offsetParent;
    }
    return {
        left, top,
    };
}

export class GrapesjsCursor {
    constructor(awareness, doc, editor) {
        this.cursors = new Map();

        const dc = editor.DomComponents;

        awareness.on('change', (_, origin) => {
            if (origin === 'local') {
                return;
            }
            awareness.getStates().forEach(({ componentId }, clientID) => {
                if (clientID === doc.clientID) {
                    return;
                }

                let cursorInfo = null;
                const container = editor.getContainer();
                const frameWrapper = container.querySelector('.gjs-frame-wrapper');
                if (!this.cursors.has(clientID)) {
                    cursorInfo = {
                        dom: cursorBuilder(),
                    };
                    this.cursors.set(clientID, cursorInfo);
                    frameWrapper.append(cursorInfo.dom);
                } else {
                    cursorInfo = this.cursors.get(clientID);
                }

                if (!componentId) {
                    cursorInfo.dom.style.display = 'none';
                    return;
                }

                const component = dc.allById()[componentId];
                if (!component) {
                    cursorInfo.dom.style.display = 'none';
                    return;
                }
                const el = component.getEl();
                const { left, top } = getBoundToRoot(el, frameWrapper);

                cursorInfo.dom.style.display = 'block';
                cursorInfo.dom.style.left = `${left}px`;
                cursorInfo.dom.style.top = `${top}px`;
                cursorInfo.dom.style.width = `${el.clientWidth}px`;
                cursorInfo.dom.style.height = `${el.clientHeight}px`;
            });
        });

        editor.on('component:selected', (component) => {
            const id = component.getId();
            if (id === 'wrapper') {
                awareness.setLocalState({
                    componentId: null,
                });
                return;
            }
            awareness.setLocalState({
                componentId: id,
            });
        });
    }
}
