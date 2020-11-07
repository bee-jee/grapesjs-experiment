import * as math from 'lib0/math';
import { createMutex } from 'lib0/mutex';
import * as error from 'lib0/error';
import { simpleDiff } from 'lib0/diff';
import * as Y from 'yjs';
import { isEqual, isString } from 'underscore';

/**
 * Either a node if type is YXmlElement or an Array of text nodes if YXmlText
 * @typedef {Map<Y.AbstractType, PModel.Node | Array<PModel.Node>>} ProsemirrorMapping
 */

/**
* @typedef {Array<Array<PModel.Node>|PModel.Node>} NormalizedPNodeContent
*/

/**
 * @param {any} component
 * @return {NormalizedPNodeContent}
 */
export const normalizePNodeContent = (component) => {
    const children = component.get('components');
    const res = [];
    for (let i = 0; i < children.length; i++) {
        const child = children.at(i);
        if (child.get('type') === 'textnode') {
            const textNodes = [];
            for (
                let tnode = child;
                i < children.length && tnode.get('type') === 'textnode';
                tnode = children.at(++i)
            ) {
                textNodes.push(tnode);
            }
            i--;
            res.push(textNodes);
        } else {
            res.push(child);
        }
    }
    return res;
}

/**
 * @private
 * @param {any|Array<any>} component prosemirror text node
 * @param {ProsemirrorMapping} mapping
 * @return {Y.XmlElement|Y.XmlText}
 */
export const createTypeFromTextOrElementNode = (component, mapping) =>
    component instanceof Array
        ? createTypeFromTextNodes(component, mapping) : createTypeFromElementNode(component, mapping);

/**
 * @private
 * @param {Array<any>} components prosemirror node
 * @param {ProsemirrorMapping} mapping
 * @return {Y.XmlText}
 */
export const createTypeFromTextNodes = (components, mapping) => {
    const type = new Y.XmlText();
    const delta = components.map((component) => ({
        insert: component.get('content'),
    }));
    type.applyDelta(delta);
    mapping.set(type, components);
    return type;
}

export const createAttributesFromComponent = (component) => {
    const obj = component.toJSON();
    obj.style = component.getStyle();
    delete obj.components;
    obj.classes = obj.classes.map((cls) => isString(cls) ? cls : cls.get('name'));
    return obj;
}

/**
 * @private
 * @param {any} component prosemirror node
 * @param {ProsemirrorMapping} mapping
 * @return {Y.XmlElement}
 */
export const createTypeFromElementNode = (component, mapping) => {
    const type = new Y.XmlElement(component.get('tagName'));
    const attrs = createAttributesFromComponent(component);
    Object.keys(attrs).forEach((key) => {
        type.setAttribute(key, attrs[key]);
    });

    let content = component.get('content');
    if (content && content.length && component.get('components').length) {
        content = '';
    }
    type.setAttribute('content', content);

    type.insert(0, normalizePNodeContent(component).map(n => createTypeFromTextOrElementNode(n, mapping)));
    mapping.set(type, component);
    return type;
}

/**
 * @private
 * @param {Y.XmlElement | Y.XmlHook} el
 * @param {any} parent
 * @param {ProsemirrorMapping} mapping
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {PModel.Node | null}
 */
export const createNodeIfNotExists = (el, parent, mapping, computeYChange) => {
    const component = mapping.get(el);
    if (component === undefined) {
        if (el instanceof Y.XmlElement) {
            return createNodeFromYElement(el, parent, mapping, computeYChange);
        } else {
            throw error.methodUnimplemented();
        }
    }
    return component;
}

/**
 * @private
 * @param {Y.XmlElement} el
 * @param {any} parent
 * @param {ProsemirrorMapping} mapping
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {PModel.Node | null} Returns node if node could be created. Otherwise it deletes the yjs type and returns null
 */
export const createNodeFromYElement = (el, parent, mapping, computeYChange) => {
    try {
        const attrs = el.getAttributes();
        const node = parent.get('components').add(attrs);
        mapping.set(el, node);
        el.toArray().forEach((type) => {
            if (type.constructor === Y.XmlElement) {
                createNodeIfNotExists(type, node, mapping, computeYChange);
            } else {
                createTextNodesFromYText(type, node, mapping, computeYChange);
            }
        });
    } catch (e) {
        console.error(e);
        // an error occured while creating the node. This is probably a result of a concurrent action.
        el.doc.transact(transaction => {
            el._item.delete(transaction);
        });
        mapping.delete(el);
    }
}

/**
 * @private
 * @param {Y.XmlText} text
 * @param {any} parent
 * @param {ProsemirrorMapping} mapping
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {Array<PModel.Node>|null}
 */
export const createTextNodesFromYText = (text, parent, mapping, computeYChange) => {
    const deltas = text.toDelta(undefined, undefined, computeYChange);
    try {
        deltas.forEach((delta) => {
            parent.get('components').add({
                type: 'textnode',
                content: delta.insert,
            });
        });
    } catch (e) {
        console.error(e);
        // an error occured while creating the node. This is probably a result of a concurrent action.
        text.doc.transact(transaction => {
            text._item.delete(transaction);
        });
    }
}

/**
 * @function
 * @param {Y.XmlElement} yElement
 * @param {any} pNode Prosemirror Node
 */
const matchNodeName = (yElement, pNode) => !(pNode instanceof Array)
    && yElement.nodeName === pNode.get('tagName')
    && yElement.getAttribute('type') === pNode.get('type');

/**
 * @param {Y.XmlElement|Y.XmlText|Y.XmlHook} ytype
 * @param {any|Array<any>} pnode
 */
const equalYTypePNode = (ytype, pnode) => {
    if (ytype instanceof Y.XmlElement && !(pnode instanceof Array) && matchNodeName(ytype, pnode)) {
        const normalizedContent = normalizePNodeContent(pnode);
        return ytype._length === normalizedContent.length
            && equalAttrs(ytype, pnode)
            && ytype.toArray().every((ychild, i) => equalYTypePNode(ychild, normalizedContent[i]));
    }
    return ytype instanceof Y.XmlText && pnode instanceof Array && equalYTextPText(ytype, pnode);
}

/**
 * @param {Y.XmlText} ytext
 * @param {Array<any>} ptexts
 */
const equalYTextPText = (ytext, ptexts) => {
    const delta = ytext.toDelta();
    return delta.length === ptexts.length
        && delta.every((d, i) => d.insert === ptexts[i].get('content'));
}

const ytextTrans = ytext => {
    let str = '';
    /**
     * @type {Y.Item|null}
     */
    let n = ytext._start;
    while (n !== null) {
        if (!n.deleted) {
            if (n.countable && n.content instanceof Y.ContentString) {
                str += n.content.str;
            }
        }
        n = n.right;
    }
    return {
        str,
    };
}

/**
 * @todo test this more
 *
 * @param {Y.Text} ytext
 * @param {Array<any>} ptexts
 * @param {ProsemirrorMapping} mapping
 */
const updateYText = (ytext, ptexts, mapping) => {
    mapping.set(ytext, ptexts);
    const { str } = ytextTrans(ytext);
    const content = ptexts.map(p => ({
        insert: p.get('content'),
        attributes: {},
    }));
    const { insert, remove, index } = simpleDiff(str, content.map(c => c.insert).join(''));
    ytext.delete(index, remove);
    ytext.insert(index, insert);
    ytext.applyDelta(content.map(c => ({ retain: c.insert.length })));
}

/**
 * @param {PModel.Node | Array<PModel.Node> | undefined} mapped
 * @param {PModel.Node | Array<PModel.Node>} pcontent
 */
const mappedIdentity = (mapped, pcontent) => mapped === pcontent
    || (
        mapped instanceof Array
        && pcontent instanceof Array
        && mapped.length === pcontent.length
        && mapped.every((a, i) => pcontent[i] === a)
    );

const equalAttrs = (ytype, pnode) => {
    const attrs = ytype.getAttributes();
    return isEqual(createAttributesFromComponent(pnode), attrs);
}

/**
 * @param {Y.XmlElement} ytype
 * @param {PModel.Node} pnode
 * @param {ProsemirrorMapping} mapping
 * @return {{ foundMappedChild: boolean, equalityFactor: number }}
 */
const computeChildEqualityFactor = (ytype, pnode, mapping) => {
    const yChildren = ytype.toArray();
    const pChildren = normalizePNodeContent(pnode);
    const pChildCnt = pChildren.length;
    const yChildCnt = yChildren.length;
    const minCnt = math.min(yChildCnt, pChildCnt);
    let left = 0;
    let right = 0;
    let foundMappedChild = false;
    for (; left < minCnt; left++) {
        const leftY = yChildren[left];
        const leftP = pChildren[left];
        if (mappedIdentity(mapping.get(leftY), leftP)) {
            foundMappedChild = true; // definite (good) match!
        } else if (!equalYTypePNode(leftY, leftP)) {
            break;
        }
    }
    for (; left + right < minCnt; right++) {
        const rightY = yChildren[yChildCnt - right - 1];
        const rightP = pChildren[pChildCnt - right - 1];
        if (mappedIdentity(mapping.get(rightY), rightP)) {
            foundMappedChild = true;
        } else if (!equalYTypePNode(rightY, rightP)) {
            break;
        }
    }
    return {
        equalityFactor: left + right,
        foundMappedChild,
    };
}

/**
 * @private
 * @param {Y.Doc} y
 * @param {Y.XmlFragment} yDomFragment
 * @param {any} component
 * @param {ProsemirrorMapping} mapping
 */
const updateYFragment = (y, yDomFragment, component, mapping) => {
    if (yDomFragment instanceof Y.XmlElement && yDomFragment.nodeName !== component.get('tagName')) {
        throw new Error('node name mismatch!');
    }
    mapping.set(yDomFragment, component);
    // update attributes
    if (yDomFragment instanceof Y.XmlElement) {
        const yDomAttrs = yDomFragment.getAttributes();
        const pAttrs = createAttributesFromComponent(component);
        for (const key in pAttrs) {
            if (pAttrs[key] !== null) {
                if (yDomAttrs[key] !== pAttrs[key] && key !== 'ychange') {
                    yDomFragment.setAttribute(key, pAttrs[key]);
                }
            } else {
                yDomFragment.removeAttribute(key);
            }
        }
        // remove all keys that are no longer in pAttrs
        for (const key in yDomAttrs) {
            if (pAttrs[key] === undefined) {
                yDomFragment.removeAttribute(key);
            }
        }
    }
    // update children
    const pChildren = normalizePNodeContent(component);
    const pChildCnt = pChildren.length;
    const yChildren = yDomFragment.toArray();
    const yChildCnt = yChildren.length;
    const minCnt = math.min(pChildCnt, yChildCnt);
    let left = 0;
    let right = 0;
    // find number of matching elements from left
    for (; left < minCnt; left++) {
        const leftY = yChildren[left];
        const leftP = pChildren[left];
        if (equalYTypePNode(leftY, leftP)) {
            // update mapping
            mapping.set(leftY, leftP);
        } else {
            break;
        }
    }
    // find number of matching elements from right
    for (; right + left + 1 < minCnt; right++) {
        const rightY = yChildren[yChildCnt - right - 1];
        const rightP = pChildren[pChildCnt - right - 1];
        if (equalYTypePNode(rightY, rightP)) {
            // update mapping
            mapping.set(rightY, rightP);
        } else {
            break;
        }
    }
    y.transact(() => {
        // try to compare and update
        while (yChildCnt - left - right > 0 && pChildCnt - left - right > 0) {
            const leftY = yChildren[left];
            const leftP = pChildren[left];
            const rightY = yChildren[yChildCnt - right - 1];
            const rightP = pChildren[pChildCnt - right - 1];
            if (leftY instanceof Y.XmlText && leftP instanceof Array) {
                if (!equalYTextPText(leftY, leftP)) {
                    updateYText(leftY, leftP, mapping);
                }
                left += 1;
            } else {
                let updateLeft = leftY instanceof Y.XmlElement && matchNodeName(leftY, leftP);
                let updateRight = rightY instanceof Y.XmlElement && matchNodeName(rightY, rightP);
                if (updateLeft && updateRight) {
                    // decide which which element to update
                    const equalityLeft = computeChildEqualityFactor(leftY, leftP, mapping);
                    const equalityRight = computeChildEqualityFactor(rightY, rightP, mapping);
                    if (equalityLeft.foundMappedChild && !equalityRight.foundMappedChild) {
                        updateRight = false;
                    } else if (!equalityLeft.foundMappedChild && equalityRight.foundMappedChild) {
                        updateLeft = false;
                    } else if (equalityLeft.equalityFactor < equalityRight.equalityFactor) {
                        updateLeft = false;
                    } else {
                        updateRight = false;
                    }
                }
                if (updateLeft) {
                    updateYFragment(y, leftY, leftP, mapping);
                    left += 1;
                } else if (updateRight) {
                    updateYFragment(y, rightY, rightP, mapping);
                    right += 1;
                } else {
                    yDomFragment.delete(left, 1);
                    yDomFragment.insert(left, [createTypeFromTextOrElementNode(leftP, mapping)]);
                    left += 1;
                }
            }
        }
        const yDelLen = yChildCnt - left - right;
        if (yDelLen > 0) {
            yDomFragment.delete(left, yDelLen);
        }
        if (left + right < pChildCnt) {
            const ins = [];
            for (let i = left; i < pChildCnt - right; i++) {
                ins.push(createTypeFromTextOrElementNode(pChildren[i], mapping));
            }
            yDomFragment.insert(left, ins);
        }
    });
}

export class GrapesjsBinding {
    /**
     * @param {Y.XmlFragment} yXmlFragment The bind source
     */
    constructor(yXmlFragment, wrapper) {
        this.type = yXmlFragment;
        this.mux = createMutex();
        this.mapping = new Map();
        this._observeFunction = this._typeChanged.bind(this);
        this.wrapper = wrapper;

        yXmlFragment.observeDeep(this._observeFunction);

        /**
         * @type {Y.Doc}
         */
        this.doc = yXmlFragment.doc;
    }

    /**
     * @param {Array<Y.YEvent>} events
     * @param {Y.Transaction} transaction
     */
    _typeChanged(events, transaction) {
        this.mux(() => {
            /**
             * @param {any} _
             * @param {Y.AbstractType} type
             */
            const delType = (_, type) => this.mapping.delete(type);
            Y.iterateDeletedStructs(transaction,
                transaction.deleteSet,
                struct => struct.constructor === Y.Item && this.mapping.delete(struct.content.type));
            transaction.changed.forEach(delType);
            transaction.changedParentTypes.forEach(delType);
            this.type.toArray()
                .forEach(t => createNodeIfNotExists(t, this.wrapper, this.mapping));
        });
    }

    _grapesjsChanged(wrapper) {
        // this.mux(() => {
        //     this.doc.transact(() => {
        //         updateYFragment(this.doc, this.type, wrapper, this.mapping);
        //     });
        // });
    }

    destroy() {
        this.type.unobserveDeep(this._observeFunction);
    }
}
