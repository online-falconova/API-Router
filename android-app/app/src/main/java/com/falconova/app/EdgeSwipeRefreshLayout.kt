package com.falconova.app

import android.content.Context
import android.util.AttributeSet
import android.view.MotionEvent
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * Pull-to-refresh container that only accepts gestures beginning at the top edge.
 * Eligibility is locked on ACTION_DOWN, so an ordinary scroll can never become a refresh.
 */
class EdgeSwipeRefreshLayout @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : SwipeRefreshLayout(context, attrs) {

    var canStartRefresh: () -> Boolean = { true }

    private val topEdgeSizePx = TOP_EDGE_DP * resources.displayMetrics.density
    private var gestureEligible = false

    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            val edgeStart = paddingTop.toFloat()
            val edgeEnd = edgeStart + topEdgeSizePx
            gestureEligible = event.y in edgeStart..edgeEnd && canStartRefresh()
        }

        if (!gestureEligible) return false

        val intercepted = super.onInterceptTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_UP ||
            event.actionMasked == MotionEvent.ACTION_CANCEL
        ) {
            gestureEligible = false
        }
        return intercepted
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!gestureEligible) return false

        val handled = super.onTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_UP ||
            event.actionMasked == MotionEvent.ACTION_CANCEL
        ) {
            gestureEligible = false
        }
        return handled
    }

    private companion object {
        const val TOP_EDGE_DP = 48f
    }
}
