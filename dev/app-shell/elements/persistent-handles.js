/*
@license
Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

class PersistentHandles extends XenBase {
  static get observedAttributes() { return ['arc','key']; }
  get _db() {
    return db.child(`arcs/${this._props.key}`);
  }
  _update(props, state, lastProps) {
    if (props.key && props.arc) { //} != lastProps.arc) {
      this._watchHandles(props.arc);
    }
  }
  _watchHandles(arc) {
    PersistentHandles.log('Syncing handles');
    let state = this._state;
    if (state.watchers) {
      state.watchers.forEach(w => w && w());
    }
    state.watching = new Set();
    state.watchers = [...arc._viewTags].map(([localHandle, tags]) => {
      if (tags && tags.has('#nosync')) {
        return;
      }
      let handleId = Arcs.utils.getContextHandleId(localHandle.type, tags);
      if (state.watching.has(handleId)) {
        return;
      }
      state.watching.add(handleId);
      // TODO(wkorman): Rename `views` to `handles` below on the next database rebuild.
      let remoteHandleMeta = this._db.child(`views/${handleId}`);
      // TODO(sjmiles): maybe not do this unless we have to (reducing FB thrash)
      remoteHandleMeta.child('metadata').update({
        type: Arcs.utils.metaTypeFromType(localHandle.type),
        name: localHandle.name || null,
        tags: [...tags]
      });
      let remoteHandle = remoteHandleMeta.child('values');
      if (localHandle.type.isSetView) {
        PersistentHandles.log(`Syncing set ${handleId}`);
        return this._syncSet(arc, localHandle, remoteHandle);
      }
      if (localHandle.type.isEntity) {
        PersistentHandles.log(`Syncing variable ${handleId}`);
        return this._syncVariable(arc, localHandle, remoteHandle);
      }
    });
  }
  // Synchronize a local variable with a remote variable.
  _syncVariable(arc, localVariable, remoteVariable) {
    var initialLoad = true;
    let callback = remoteVariable.on('value', snapshot => {
      if (snapshot.val() && !snapshot.val().id.startsWith(arc.id)) {
        localVariable.set(snapshot.val());
      } else if (!snapshot.val()) {
        localVariable.clear();
      }
      if (initialLoad) {
        // Once the first load is complete sync starts listening to
        // local changes and applying those to the remote variable.
        initialLoad = false;
        localVariable.on('change', change => {
          if (change.data && change.data.id.startsWith(arc.id)) {
            remoteVariable.set(Arcs.utils.removeUndefined(change.data));
          } else if (change.data === undefined) {
            remoteVariable.remove();
          }
        }, {});
      }
    });
    return () => remoteVariable.off('value', callback);
  }
  _syncSet(arc, localSet, remoteSet) {
    let off = [];
    let cb = remoteSet.on('child_added', data => {
      if (!data.val().id.startsWith(arc.id)) {
        localSet.store(data.val());
      }
    });
    off.push(() => remoteSet.off('child_added', cb));
    cb = remoteSet.on('child_removed', data => {
      // Note: element will only be removed and 'remove' event will only be
      // fired iff the ID is present in the set.
      localSet.remove(data.val().id);
    });
    off.push(() => remoteSet.off('child_removed', cb));
    // Since child_added events for the initial, pre-loaded data above will
    // fire *before* the value event fires on the parent, we use the value
    // event to detect when initial loading is done. That is when we start
    // listening to local set changes.
    remoteSet.once('value', snapshot => {
      // At this point we're guaranteed the initial remote load is done.
      localSet.on('change', change => {
        if (change.add) {
          change.add.forEach(a => {
            // Only store changes that were made locally.
            if (a.id.startsWith(arc.id)) {
              remoteSet.push(Arcs.utils.removeUndefined(a));
            }
          });
        } else if (change.remove) {
          change.remove.forEach(r => {
            remoteSet.orderByChild('id').equalTo(r.id).once('value', snapshot => {
              snapshot.forEach(data => {
                remoteSet.child(data.key).remove();
              });
            });
          });
        } else {
          PersistentHandles.log('Unsupported change', change);
        }
      }, {});
    });
    return () => off.forEach(w => w && w());
  }
}
PersistentHandles.log = XenBase.logFactory('PersistentHandles', '#aa00c7');
customElements.define('persistent-handles', PersistentHandles);