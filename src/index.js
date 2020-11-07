import grapesjs from 'grapesjs';
import 'grapesjs-preset-webpage';
import './css/grapes.min.css';
import './css/styles.css';
import * as Y from 'yjs';
import { GrapesjsBinding } from './y-grapesjs/sync';
import { IndexeddbPersistence } from 'y-indexeddb';

const doc = new Y.Doc();

const persistence = new IndexeddbPersistence('test', doc);

persistence.on('synced', () => {
    console.log(doc);
});

const editor = grapesjs.init({
    height: '100%',
    container: '#gjs',
    components: '',
    plugins: [
        'gjs-preset-webpage',
    ],
    storageManager: null,
});

const binding = new GrapesjsBinding(doc, editor);

doc.on('update', () => {
    console.log(doc);
});

// function getComponentClasses(component) {
//     return component.get('classes').map((cls) => {
//         return typeof cls === 'string' ? cls : cls.get('name');
//     });
// }

// editor.on('update', () => {
//     const cssRules = editor.getModel().get('CssComposer').getAll();
//     binding._grapesjsChanged(editor.getModel().getWrapper(), cssRules);
//     console.log(editor.getModel().getComponents());
//     editor.getModel().get('storables').forEach(m => {
//         console.log(m.store);
//         const obj = m.store(1);
//         console.log(obj);
//     });
// });

editor.on('component:update', (model, style = {}, opts = {}) => {
    // console.log(getComponentClasses(model));
    // console.log(model.changed);
    // if (opts.avoidStore) {
    //     return;
    // }
    // if ('open' in model.changed) {
    //     return;
    // }
    // if (model.changed.status === 'selected') {
    //     return;
    // }
    // console.log(style);
    // console.log(model);
    // console.log(model.changed);
    // console.log(model.getAttributes());
    // console.log(model.getStyle());
    // console.log(model.get('content'));
    // model.get('components').models.forEach((model) => {
    //     console.log(model.getChangedProps());
    // });
});

const domComponents = editor.DomComponents;

// setTimeout(() => {
//     const wrapperChildren = domComponents.getComponents();
//     const comp1 = wrapperChildren.add({
//         style: { 'background-color': 'red' }
//     });
//     // Now let's add an other one inside first component
//     // First we have to get the collection inside. Each
//     // component has 'components' property
//     const comp1Children = comp1.get('components');
//     // Procede as before. You could also add multiple objects
//     comp1Children.add([
//         {
//             style: {
//                 height: '100px',
//                 width: '100px',
//                 'background-color': 'blue',
//                 color: 'white',
//             },
//             content: 'This is a blue box',
//         },
//     ]);
// }, 3000);
// Remove comp2
// setTimeout(() => {
//     wrapperChildren.remove(comp2);
// }, 3000);
