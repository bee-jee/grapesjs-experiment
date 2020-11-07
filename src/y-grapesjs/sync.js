import * as math from 'lib0/math';
import { createMutex } from 'lib0/mutex';
import * as error from 'lib0/error';
import { simpleDiff } from 'lib0/diff';
import * as Y from 'yjs';
import { isArray, isEqual, isObject, isString } from 'underscore';

/**
 * Either a node if type is YXmlElement or an Array of text nodes if YXmlText
 * @typedef {Map<Y.AbstractType, any>} GrapesjsMapping
 */

/**
* @typedef {Array<any>} NormalizedComponentContent
*/

/**
 * @param {any} component
 * @return {NormalizedComponentContent}
 */
export const normalizeComponentContent = (component) => {
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
 * @param {any|Array<any>} component grapesjs text node
 * @param {GrapesjsMapping} mapping
 * @return {Y.XmlElement|Y.XmlText}
 */
export const createTypeFromTextOrElementNode = (component, mapping) =>
    component instanceof Array
        ? createTypeFromTextNodes(component, mapping) : createTypeFromElementNode(component, mapping);

/**
 * @private
 * @param {Array<any>} components grapesjs node
 * @param {GrapesjsMapping} mapping
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
    delete obj.components;
    if (obj.classes) {
        obj.classes = obj.classes.map((cls) => isString(cls) ? cls : cls.get('name'));
    }
    return obj;
}

/**
 * @private
 * @param {any} component grapesjs node
 * @param {GrapesjsMapping} mapping
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

    type.insert(0, normalizeComponentContent(component).map(n => createTypeFromTextOrElementNode(n, mapping)));
    mapping.set(type, component);
    return type;
}

/**
 * @private
 * @param {Y.XmlElement | Y.XmlHook} el
 * @param {any} parent
 * @param {GrapesjsMapping} mapping
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {any | null}
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
 * @param {GrapesjsMapping} mapping
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {any | null} Returns node if node could be created. Otherwise it deletes the yjs type and returns null
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
 * @param {GrapesjsMapping} mapping
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {Array<any>|null}
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
 * @param {any} component Grapesjs Node
 */
const matchNodeName = (yElement, component) => !(component instanceof Array)
    && yElement.nodeName === component.get('tagName')
    && yElement.getAttribute('type') === component.get('type');

/**
 * @param {Y.XmlElement|Y.XmlText|Y.XmlHook} ytype
 * @param {any|Array<any>} gnode
 */
const equalYTypeGNode = (ytype, gnode) => {
    if (ytype instanceof Y.XmlElement && !(gnode instanceof Array) && matchNodeName(ytype, gnode)) {
        const normalizedContent = normalizeComponentContent(gnode);
        return ytype._length === normalizedContent.length
            && equalAttrs(ytype, gnode)
            && ytype.toArray().every((ychild, i) => equalYTypeGNode(ychild, normalizedContent[i]));
    }
    return ytype instanceof Y.XmlText && gnode instanceof Array && equalYTextGText(ytype, gnode);
}

/**
 * @param {Y.XmlText} ytext
 * @param {Array<any>} gtexts
 */
const equalYTextGText = (ytext, gtexts) => {
    const delta = ytext.toDelta();
    return delta.length === gtexts.length
        && delta.every((d, i) => d.insert === gtexts[i].get('content'));
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
 * @param {Array<any>} gtexts
 * @param {GrapesjsMapping} mapping
 */
const updateYText = (ytext, gtexts, mapping) => {
    mapping.set(ytext, gtexts);
    const { str } = ytextTrans(ytext);
    const content = gtexts.map(p => ({
        insert: p.get('content'),
        attributes: {},
    }));
    const { insert, remove, index } = simpleDiff(str, content.map(c => c.insert).join(''));
    ytext.delete(index, remove);
    ytext.insert(index, insert);
    ytext.applyDelta(content.map(c => ({ retain: c.insert.length })));
}

/**
 * @param {any | Array<any> | undefined} mapped
 * @param {any | Array<any>} component
 */
const mappedIdentity = (mapped, component) => mapped === component
    || (
        mapped instanceof Array
        && component instanceof Array
        && mapped.length === component.length
        && mapped.every((a, i) => component[i] === a)
    );

const equalAttrs = (ytype, component) => {
    const attrs = ytype.getAttributes();
    return isEqual(createAttributesFromComponent(component), attrs);
}

/**
 * @param {Y.XmlElement} ytype
 * @param {any} component
 * @param {GrapesjsMapping} mapping
 * @return {{ foundMappedChild: boolean, equalityFactor: number }}
 */
const computeChildEqualityFactor = (ytype, component, mapping) => {
    const yChildren = ytype.toArray();
    const pChildren = normalizeComponentContent(component);
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
        } else if (!equalYTypeGNode(leftY, leftP)) {
            break;
        }
    }
    for (; left + right < minCnt; right++) {
        const rightY = yChildren[yChildCnt - right - 1];
        const rightP = pChildren[pChildCnt - right - 1];
        if (mappedIdentity(mapping.get(rightY), rightP)) {
            foundMappedChild = true;
        } else if (!equalYTypeGNode(rightY, rightP)) {
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
 * @param {GrapesjsMapping} mapping
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
    const gChildren = normalizeComponentContent(component);
    const gChildCnt = gChildren.length;
    const yChildren = yDomFragment.toArray();
    const yChildCnt = yChildren.length;
    const minCnt = math.min(gChildCnt, yChildCnt);
    let left = 0;
    let right = 0;
    // find number of matching elements from left
    for (; left < minCnt; left++) {
        const leftY = yChildren[left];
        const leftP = gChildren[left];
        if (equalYTypeGNode(leftY, leftP)) {
            // update mapping
            mapping.set(leftY, leftP);
        } else {
            break;
        }
    }
    // find number of matching elements from right
    for (; right + left + 1 < minCnt; right++) {
        const rightY = yChildren[yChildCnt - right - 1];
        const rightP = gChildren[gChildCnt - right - 1];
        if (equalYTypeGNode(rightY, rightP)) {
            // update mapping
            mapping.set(rightY, rightP);
        } else {
            break;
        }
    }
    y.transact(() => {
        // try to compare and update
        while (yChildCnt - left - right > 0 && gChildCnt - left - right > 0) {
            const leftY = yChildren[left];
            const leftP = gChildren[left];
            const rightY = yChildren[yChildCnt - right - 1];
            const rightP = gChildren[gChildCnt - right - 1];
            if (leftY instanceof Y.XmlText && leftP instanceof Array) {
                if (!equalYTextGText(leftY, leftP)) {
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
        if (left + right < gChildCnt) {
            const ins = [];
            for (let i = left; i < gChildCnt - right; i++) {
                ins.push(createTypeFromTextOrElementNode(gChildren[i], mapping));
            }
            yDomFragment.insert(left, ins);
        }
    });
}

export const equalYArrayArray = (yArray, arr) => {
    return isEqual(yArray.toJSON(), arr);
}

export const equalYMapObject = (yMap, obj) => {
    return isEqual(yMap.toJSON(), obj);
}

export const createYMapFromObj = (obj) => {
    const yMap = new Y.Map();
    Object.keys(obj).forEach((key) => {
        yMap.set(key, createYValueFromJS(obj[key]));
    });
    return yMap;
}

export const createYArrayFromArray = (arr) => {
    const yArray = new Y.Array();
    arr.forEach((value) => {
        yArray.push([createYValueFromJS(value)]);
    });
    return yArray;
}

export const createYValueFromJS = (value) => {
    if (isArray(value)) {
        return createYArrayFromArray(value);
    }
    if (isObject(value)) {
        return createYMapFromObj(value);
    }
    return value;
}

export const updateYArray = (yArray, arr) => {
    if (equalYArrayArray(yArray, arr)) {
        return;
    }
    const min = math.min(yArray.length, arr.length);
    let i = 0;
    for (; i < min; i++) {
        const yValue = yArray.get(i);
        const value = arr[i];

        if (yValue instanceof Y.Array && isArray(value)) {
            updateYArray(yValue, value);
            continue;
        }

        if (yValue instanceof Y.Map && isObject(value)) {
            updateYMap(yValue, value);
            continue;
        }

        if (yValue !== value) {
            yArray.insert(i, createYValueFromJS(value));
        }
    }
    if (i < yArray.lengt) {
        yArray.delete(i, yArray.length - i);
    } else if (i < arr.length) {
        for (; i < arr.length; i++) {
            yArray.push([createYValueFromJS(arr[i])]);
        }
    }
}

export const updateYMap = (yMap, obj) => {
    Object.keys(obj).forEach((key) => {
        const value = obj[key];
        if (yMap.has(key)) {
            const yValue = yMap.get(key);

            if (yValue instanceof Y.Array && isArray(value)) {
                updateYArray(yValue, value);
                return;
            }

            if (yValue instanceof Y.Map && isObject(value)) {
                updateYMap(yValue, value);
                return;
            }

            if (yValue === value) {
                return;
            }
        }
        yMap.set(key, createYValueFromJS(value));
    });
    const deleted = [];
    const keys = yMap.keys();
    for (const key  of keys) {
        if (!(key in obj)) {
            deleted.push(key);
        }
    }
    deleted.forEach((key) => {
        yMap.delete(key);
    });
}

export const ruleToObj = (rule) => {
    const obj = rule.toJSON();
    if (obj.selectors) {
        obj.selectors = obj.selectors.toJSON();
    }
    return obj;
}

export const keyFromRule = (rule) => {
    const prefix = [
        rule.get('atRuleType'),
        rule.get('mediaText'),
    ].filter((part) => part).join('-');
    return `${prefix}${rule.selectorsToString()}`;
}

export const updateCssRules = (doc, yCssRules, gCssRules) => {
    const keySet = new Set();
    gCssRules.each((rule) => {
        const key = keyFromRule(rule);
        keySet.add(key);
        if (!yCssRules.has(key)) {
            yCssRules.set(key, new Y.Map());
        }
        const yValue = yCssRules.get(key);
        const value = ruleToObj(rule);
        if (!equalYMapObject(yValue, value)) {
            updateYMap(yCssRules.get(key), value);
        }
    });
    for (const key of yCssRules.keys()) {
        if (!keySet.has(key)) {
            yCssRules.delete(key);
        }
    }
}

export class GrapesjsBinding {
    constructor(doc, editor) {
        this.muxDocComponents = createMutex();
        this.muxCssRules = createMutex();
        this.docComponentsMapping = new Map();
        this._observeDomComponentsFunction = this._docComponentsChanged.bind(this);
        this._observeCssRulesFunction = this._cssRulesChanged.bind(this);

        this.wrapper = editor.getModel().getWrapper();

        const domComponents = doc.get('domComponents', Y.XmlFragment);
        const cssRules = doc.get('cssRules', Y.Map);
        this.domComponents = domComponents;
        this.cssRules = cssRules;
        this.editor = editor;

        domComponents.observeDeep(this._observeDomComponentsFunction);
        cssRules.observeDeep(this._observeCssRulesFunction);
        editor.on('update', this._grapesjsChanged.bind(this));

        /**
         * @type {Y.Doc}
         */
        this.doc = doc;
    }

    _docComponentsChanged(events, transaction) {
        this.muxDocComponents(() => {
            /**
             * @param {any} _
             * @param {Y.AbstractType} type
             */
            const delType = (_, type) => this.docComponentsMapping.delete(type);
            Y.iterateDeletedStructs(transaction,
                transaction.deleteSet,
                struct => struct.constructor === Y.Item && this.docComponentsMapping.delete(struct.content.type));
            transaction.changed.forEach(delType);
            transaction.changedParentTypes.forEach(delType);
            this.domComponents.toArray()
                .forEach(t => createNodeIfNotExists(t, this.wrapper, this.docComponentsMapping));
        });
    }

    _cssRulesChanged(events, transaction) {
        this.muxCssRules(() => {
            const cssComposer = this.editor.CssComposer;
            const sm = this.editor.SelectorManager;
            const rules = this.cssRules.toJSON() || {};
            Object.keys(rules).forEach((key) => {
                const rule = rules[key];
                const selectors = rule.selectors.map((selector) => {
                    return sm.add(selector);
                });
                const r = cssComposer.add(selectors, rule.state || '', rule.mediaText, rule);
            });
        });
    }

    _grapesjsChanged() {
        this.muxDocComponents(() => {
            this.doc.transact(() => {
                updateYFragment(this.doc, this.domComponents, this.wrapper, this.docComponentsMapping);
            });
        });
        this.muxCssRules(() => {
            this.doc.transact(() => {
                const cssRules = this.editor.getModel().get('CssComposer').getAll();
                updateCssRules(this.doc, this.cssRules, cssRules);
            });
        });
    }

    destroy() {
        this.domComponents.unobserveDeep(this._observeDomComponentsFunction);
    }
}
