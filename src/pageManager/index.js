import grapesjs from 'grapesjs';

const pageView = (editor) => ({
    init({ editor, model }) {
        this.em = editor.getModel();
        this.canvas = this.em.get('Canvas');
        this.setupDragger();

        this.listenTo(model, 'change:x change:y', this.updatePos);
    },

    events: {
        'mousedown [data-action-move]': 'startDrag',
        'mouseup': 'stopDrag',
    },

    onRender({ el, model }) {
        const { x, y, width, height } = model.attributes;
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.position = 'absolute';
        el.style.top = `${y}px`;
        el.style.left = `${x}px`;
        el.style.width = `${width}px`;
        el.style.height = `${height}px`;
    },

    setupDragger() {
        const { model, canvas } = this;
        let dragX, dragY, zoom;
        const toggleEffects = on => {
            canvas.toggleFramesEvents(on);
        };

        this.dragger = new editor.Utils.Dragger({
            onStart: () => {
                const { x, y } = model.attributes;
                zoom = this.em.getZoomMultiplier();
                dragX = x;
                dragY = y;
                toggleEffects();
            },
            onEnd: () => toggleEffects(1),
            setPosition: (posOpts) => {
                model.set({
                    x: dragX + posOpts.x * zoom,
                    y: dragY + posOpts.y * zoom,
                });
            },
        });
    },

    startDrag(e) {
        e && this.dragger.start(e);
    },

    stopDrag(e) {
        this.dragger.stop(e);
    },

    updatePos() {
        const { model, el } = this;
        const { x, y } = model.attributes;
        const { style } = el;
        style.left = isNaN(x) ? x : `${x}px`;
        style.top = isNaN(y) ? y : `${y}px`;
        model.emitUpdated();
    },
});

const pageComponent = (editor) => {
    let titleComponent = null;
    let bodyComponent = null;
    let updateItr;

    return {
        init() {
            this.listenTo(this, 'change:title', this.updateTitle);

            const id = this.getId();
            const components = this.get('components');

            titleComponent = components.add({
                tagName: 'div',
                draggable: false,
                droppable: false,
                copyable: false,
                removable: false,
                selectable: false,
                hoverable: false,
                classes: [
                    'page-title',
                ],
                attributes: {
                    'data-action-move': '',
                },
            });
            titleComponent.setId(`${id}-page-title`);

            bodyComponent = components.add({
                tagName: 'div',
                draggable: false,
                copyable: false,
                removable: false,
                selectable: false,
                hoverable: false,
                classes: [
                    'page-body',
                ],
            });
            bodyComponent.setId(`${id}-page-body`);

            this.updateTitle();
        },
        defaults: {
            ...editor.DomComponents.getType('default').model.prototype.defaults,
            draggable: false,
            droppable: false,
            copyable: false,
        },
        updateTitle() {
            const { title } = this.attributes;
            if (titleComponent) {
                titleComponent.set('components', title);
            }
        },
        emitUpdated() {
            this.em.trigger('frame:updated');
            updateItr && clearTimeout(updateItr);
            updateItr = setTimeout(() => this.em.trigger('update'));
        },
    };
};

const createPageComponent = (editor) => {
    return {
        model: pageComponent(editor),
        view: pageView(editor),
    };
};

const pageManager = (editor) => {
    const config = editor.getConfig();
    const panels = editor.Panels;
    const commands = editor.Commands;

    commands.add('addPage', {
        run(editor) {
            editor.DomComponents.addComponent({
                type: 'page',
                x: 100,
                y: 100,
                width: 500,
                height: 400,
                title: 'Untitled',
            });
        },
    });

    panels.addPanel({
        id: 'page-p',
        buttons: [
            {
                id: 'addPage',
                className: 'gjs-pn-btn fa fa-plus-square',
                attributes: { title: 'Add page' },
                command: 'addPage',
            },
        ],
    });

    config.showDevices = 0;
    config.baseCss = `
        * {
            box-sizing: border-box;
            font-family: sans-serif;
        }
        html, body, [data-gjs-type=wrapper] {
            min-height: 100%;
        }
        body {
            margin: 0;
            height: 100%;
            background-color: #ccc
        }
        [data-gjs-type=wrapper] {
            overflow: auto;
            overflow-x: hidden;
        }

        .page-title {
            flex-basis: auto;
            user-select: none;
            cursor: move;
            padding: 10px;
            min-height: 16px;
        }
        .page-body {
            flex: 1;
            background: #fff;
            overflow: auto;
        }
    `;
    const wrapper = editor.DomComponents.getComponent();
    wrapper.set({
        droppable: false,
        selectable: false,
        hoverable: false,
    });
    editor.DomComponents.addType('page', createPageComponent(editor));
};

grapesjs.plugins.add('page-manager', pageManager);
