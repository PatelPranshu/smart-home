import 'package:flutter/material.dart';

void showToast(BuildContext context, String message, {bool isError = false}) {
  ScaffoldMessenger.of(context).removeCurrentSnackBar();
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Row(
        children: [
          Icon(isError ? Icons.error_outline : Icons.check_circle_outline, color: Colors.white),
          SizedBox(width: 12),
          Expanded(child: Text(message, style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
        ],
      ),
      backgroundColor: isError ? Colors.red.shade600 : Colors.green.shade600,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      margin: EdgeInsets.symmetric(horizontal: 20, vertical: 20),
      duration: Duration(seconds: 3),
      elevation: 6,
    )
  );
}
